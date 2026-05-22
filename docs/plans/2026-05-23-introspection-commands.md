# Introspection commands — `event:list`, `config:show`, `route:list --verbose`

**Status:** plan, 2026-05-23. Pickup task for the next framework session.
**Origin:** DX session 2026-05-23 — surveyed existing introspection coverage. We ship `route:list`, `command:list`, `mcp:list`, `schedule:list`, `sync:docs`, `sync:inspect`, `queue:status`, `queue:failed`, `broadcast:connections`, `model:prune`. Three obvious gaps remain that show up in real debugging sessions — events, config, and middleware resolution per route.

---

## Why this exists

When something doesn't fire — a listener that never runs, a config value that's wrong in prod, a middleware that's missing from a route — the user's only debug path today is grep + `console.log` + restart. Three small commands close each of those loops:

| Question | Today | After |
|---|---|---|
| "Is my listener registered?" | grep `eventsProvider`, trace through providers.ts | `pnpm rudder event:list` |
| "What's the resolved value of `cache.default` in this env?" | open `config/cache.ts` + read .env + guess | `pnpm rudder config:show cache` |
| "Which middleware actually runs on `/dashboard`?" | open routes/web.ts + bootstrap/app.ts + provider boot logs | `pnpm rudder route:list --verbose` |

Each of these maps to a known footgun. From `CLAUDE.md` "Common Pitfalls": `req.user` undefined on api routes, `No session in context` on api routes, RateLimit not working — all middleware-group-resolution issues that `route:list --verbose` would self-diagnose.

## Goals

- Three small commands ship in one PR (single coherent surface area).
- Match existing convention: pretty table by default + `--json` for machine output.
- `config:show` redacts sensitive keys by default (`*_KEY`, `*_SECRET`, `password`, `token`, `dsn`).
- `event:list` reports per-event listener counts AND listener class names.
- `route:list --verbose` extends the existing command — no breaking change.

## Non-goals

- No `provider:list` — boot-order debug already covered by the dev-mode boot log (provider stage + topo prints right before `[RudderJS] ready`). Adding a separate command would duplicate.
- No `model:show` — defer to a follow-up. The ORM's column/relation introspection isn't surfaced uniformly across Prisma/Drizzle adapters yet; the right home is the orm package after that lands.
- No `db:show` — covered well enough by `pnpm rudder doctor --deep` (`runtime:db-connect`) for "is the DB reachable" and `pnpm exec prisma db pull` for schema introspection.
- No watch mode / live reload on any of these. CLI invocations only.

## Architecture

### `event:list` — new command in `@rudderjs/core`

Subpath: `@rudderjs/core/commands/event-list`. The dispatcher singleton already lives in `packages/core/src/events.ts` and exposes `dispatcher.list()` returning `Record<string, number>`. Listener class names aren't in that return shape today — extend `EventDispatcher` with one method:

```ts
// packages/core/src/events.ts — additive
inspect(): { event: string; listeners: string[] }[]
```

Then the command:

```
pnpm rudder event:list
pnpm rudder event:list --json
pnpm rudder event:list --filter Subscription   # substring match on event name
```

Output:

```
  Event                          Listeners
  ─────────────────────────      ─────────────────────────
  UserRegistered                 WelcomeNotification, AuditLog
  PaddleSubscriptionUpdated      SyncSubscriptionListener
  *                              (wildcard) TelescopeRecorder
```

Wildcard listeners surface as the literal `*` row. Zero registered events → "No events registered." (mirrors `route:list`'s empty-state line).

Requires `bootApp()` to register listeners — uses the same boot wrapper pattern as `mcp:list` / `schedule:list`.

### `config:show` — new command in `@rudderjs/core`

Subpath: `@rudderjs/core/commands/config-show`. Reads from `getConfigRepository()` (already exposed via `@rudderjs/support`).

```
pnpm rudder config:show                 # all sections (top-level keys + counts)
pnpm rudder config:show cache           # full cache section as YAML-ish tree
pnpm rudder config:show cache.default   # leaf value
pnpm rudder config:show --json          # whole config as JSON (redacted)
pnpm rudder config:show cache --raw     # no redaction (opt-in; warns on stdout)
```

**Redaction.** Recursive walk, replace leaf string values with `***` when the leaf key matches `/_(key|secret|password|token|dsn)$/i` OR the value matches a long random-looking string (>= 20 chars + entropy heuristic — skip for v1 if too noisy; rely on key-name match first). `--raw` opts out and prints a one-line stderr warning.

Output (no arg):

```
  Section          Keys
  ─────────────    ────
  app              5
  auth             3
  cache            4
  database         6
  ...
  17 sections, 84 keys total.
```

Output (`config:show cache`):

```
  cache:
    default:    redis
    stores:
      redis:
        driver: redis
        url:    ***
      array:
        driver: array
    prefix:     rudderjs_cache_
```

Requires `bootApp()` so config providers' boot-time mutations (e.g. environment-derived overrides) are reflected.

### `route:list --verbose` — extend existing command

Today `route:list` shows per-route middleware names (the per-route middleware passed to `router.get(...).middleware(...)`). What it doesn't expose is the prepended `[global → group]` chain that actually runs before the per-route stack at request time. `--verbose` adds that resolved full stack:

```
  GET     /dashboard              MIDDLEWARE
  ─────   ──────────              ──────────
                                  [global]  requestIdMiddleware
                                  [web]     RateLimit(60/min), CsrfMiddleware
                                  [route]   AuthMiddleware
```

Implementation lives in `packages/router/src/commands/route-list.ts`. Walks three sources:

1. **Global** — the `m.use(...)` stack. Lives in `app-builder.ts` (`_useHandlers`). Need to expose a getter; today it's read by `appendMiddleware()` but not surfaced. Add `Application.middlewareSnapshot(): { global: Fn[]; groups: Record<string, Fn[]> }` and call it from the command via `app().middlewareSnapshot()`.
2. **Group** — `groupMiddlewareStore` (already exported by `@rudderjs/core/application.ts:366`). Filter by route tag.
3. **Per-route** — already available on `router.list()` output as `route.middleware`.

`--json` extends to emit `{ global, group, route }` triples per route.

Group detection per route already happens via the loader tag (`'web' | 'api' | null`). `router.list()` doesn't expose the tag today — extend `ApiRoute` to include `group?: 'web' | 'api'` so the verbose path can prepend the right group stack. Routes without a tag (manually registered) skip the group section.

### CLI loader registration

Three `tryImport` entries appended to `packages/cli/src/index.ts`:

```ts
const mod = await tryImport('@rudderjs/core', 'commands/event-list')
const mod = await tryImport('@rudderjs/core', 'commands/config-show')
// route-list already loaded; no new entry needed.
```

Bumps the loader entry count by 2 (mirroring the existing pattern for `route:list`, `model:prune`, etc.).

## Phases

### Phase 1 — `EventDispatcher.inspect()` + `event:list`

- Add `EventDispatcher.inspect()` method.
- Add `packages/core/src/commands/event-list.ts` with `registerEventListCommand(rudder)`.
- Add subpath export `./commands/event-list` to `@rudderjs/core/package.json`.
- Wire in `packages/cli/src/index.ts` via `tryImport`.
- Tests: registered events render, wildcard surfaces, `--filter` narrows, `--json` shape, empty-state message.

### Phase 2 — `Application.middlewareSnapshot()` + `route:list --verbose`

- Add `Application.middlewareSnapshot()` returning `{ global: Fn[]; groups: Record<string, Fn[]> }`.
- Extend `Router.list()` output to include `group?: 'web' | 'api'` (the loader tag is already captured; just plumb it through).
- Extend `packages/router/src/commands/route-list.ts` with `--verbose` branch (pretty + JSON).
- Tests: route with no group tags, route with web tag, route with api tag, route with per-route middleware on top of group + global, `--verbose --json` shape.

### Phase 3 — `config:show`

- Add `packages/core/src/commands/config-show.ts` with redaction helper.
- Add subpath export `./commands/config-show`.
- Wire in `packages/cli/src/index.ts`.
- Tests: no-arg lists sections, dotted key resolves leaf, missing key surfaces "not found" message, redaction by key-name pattern, `--raw` warns + prints, `--json` round-trip.

### Phase 4 — Docs

- `docs/guide/cli.md` (or wherever the rudder CLI reference lives) — three new rows with usage examples.
- README "One CLI" line — keep the existing one-line summary, extend the bullet list with the three commands.
- Per-package CLAUDE.md commands sections (core + router) — add the new rows.

### Phase 5 — Changeset + ship

- `@rudderjs/core` — minor (new `commands/event-list`, `commands/config-show` subpaths + `EventDispatcher.inspect()` + `Application.middlewareSnapshot()`).
- `@rudderjs/router` — minor (`route:list --verbose` + `ApiRoute.group` field on `router.list()` output).
- `@rudderjs/cli` — patch (two new loader entries).

## Test plan

Each command gets a dedicated test file under its owning package:

- `packages/core/src/commands/event-list.test.ts` — 5 cases (registered, wildcard, filter, json, empty)
- `packages/core/src/commands/config-show.test.ts` — 7 cases (sections, leaf, missing, redaction, raw warning, json, deep section)
- `packages/router/src/commands/route-list.test.ts` (extend if exists, else new) — 5 cases for `--verbose` (no group, web, api, with per-route mw, json shape)

Plus the existing 32-cell scaffolder smoke matrix — all three commands should be invocable on a freshly-scaffolded app without errors (even when output is empty).

## Risks

- **`config:show` redaction false negatives.** A sensitive value stored under a non-suspicious key (e.g. `app.adminContact = "support@..."` or a custom `app.signingMaterial`) won't get redacted. Mitigation: document the rule explicitly; `--raw` is one keystroke away when the user knows what they're doing. Don't try to be clever about value-shape detection in v1.
- **`route:list --verbose` middleware-order accuracy.** The composed order at the verbose printout must match the actual request-time composition. If it diverges, the command is a liability (users will trust the wrong order). Mitigation: the order is `[global → group → route]` per `app-builder.ts:71` (`return [...groupMiddlewareStore[group], ...this._groupHandlers[group]]`) — same code path runs at request time. Add one integration test that registers a known stack and asserts the printout matches the dispatch order in `server-hono`.
- **`event:list` listener-name visibility.** Listener instances may be plain objects (when `eventsProvider` instantiates them) or anonymous closures (when `dispatcher.register('Foo', { handle: () => {} })` is called inline). The latter renders as `Object` or `<anonymous>`. Mitigation: render `<anonymous>` for that case; document that named Listener classes get the best output.
- **Boot requirement for two of the three.** `event:list` and `config:show` both need `bootApp()`. That's slower than the skip-boot scaffolder commands. Mitigation: same as `mcp:list` / `schedule:list` — the command's handler calls `bootApp()` once; no special UX.
- **No new public-API breakage.** `EventDispatcher.inspect()` is additive; `Application.middlewareSnapshot()` is additive; `Router.list()` gains an optional `group?` field (additive). Existing consumers keep working.

## Out of scope / follow-up

- **`model:show`** — needs uniform adapter introspection (Prisma + Drizzle) that doesn't exist yet. Ship after orm adapter contract widens.
- **`provider:list`** — covered by dev-mode boot log; don't duplicate.
- **`config:show` with environment override view** — "value before .env, value after .env" diff. Useful for prod-deploy debugging but a meaningfully different surface; defer.
- **`event:list --queue`** — show which listeners are queued vs sync. Listener queueing is per-listener config; not a single-field read. Defer until the queue/listener composition firms up.
- **`route:list` filters (`--path=...`, `--package=<name>`, `--exclude-package=<name>`)** — narrow output to routes matching a path prefix or registered by a specific framework package (auth, cashier, …). Becomes valuable once 3+ packages contribute routes via `register*Routes()`; today only auth does. Defer.
- **Watch mode (`--watch`)** — auto-rerun on filesystem change. Better fit for an integrated dev-server UX than a per-command flag.

## Effort

~3-4 hours: Phase 1 (~45 min), Phase 2 (~90 min — most of the work is in the middleware snapshot wiring), Phase 3 (~45 min), Phase 4 (~30 min), changeset + PR.

## Composes with

- **`2026-05-19-rudder-doctor-command.md`** — independent. Doctor diagnoses; introspection commands narrate the state. Different question shapes.
- **`2026-05-20-dx-completion.md`** — same family of work (CLI DX); this is the next coherent batch after that plan landed.

## Language

Plan + commit messages + PR body + code + docs describe the commands directly (what they do, when to use them). No comparisons to other frameworks anywhere in the user-facing surface. Memory rule: describe RudderJS directly, not by analogy.
