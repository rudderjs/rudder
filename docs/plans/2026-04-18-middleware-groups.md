# Middleware Groups — `web` vs `api` (Laravel-style)

**Status:** Shipped 2026-04-18. All 7 phases complete; verified end-to-end via playground (`/api/health` — api group only; `/` — web group with session + auth; `/api/passport/me` — api group + per-route bearer). Telescope request chains confirm the correct group stacks per route.

**Target packages:** `@rudderjs/core`, `@rudderjs/router`, `@rudderjs/server-hono`, `@rudderjs/auth`, `@rudderjs/session`, playground.

**Motivation:** Right now `@rudderjs/auth`'s provider calls `router.use(AuthMiddleware())` globally in `boot()` (`packages/auth/src/index.ts:158-165`), and that middleware eagerly calls `SessionGuard.user()` → `Session.current()`, which throws hard when no session ALS context is present. The symptom: removing `m.use(sessionMiddleware(...))` from `bootstrap/app.ts` breaks **every** request (including `/api/health`) with `[RudderJS Session] No session in context.` Session has silently become load-bearing on every route.

Laravel avoids this with middleware groups: `StartSession` is in the `web` group only; `api` is stateless; auth is opt-in per route, not global. Port that model.

---

## Goals

1. `session`, `auth` (and anything else web-specific) run on **web** routes only.
2. `api` routes are stateless by default — `RequireBearer()` or `RequireAuth('api')` is explicit when needed.
3. `req.user` on web routes still works the same as today (no behavior change for web).
4. Provider authors (e.g. `@rudderjs/auth`, `@rudderjs/session`) install into a **named group**, not into `router.use(...)` globally.
5. Zero-breakage for apps not using auth/session (they already work; they keep working).

## Non-Goals

- Not changing `AuthMiddleware`'s public API. Handlers that read `req.user` still do.
- Not introducing arbitrary user-defined groups in v1 — only `web` and `api` (plus `commands` / `channels` which don't participate in HTTP middleware).
- Not rewriting the router. Per-route middleware `Route.get(path, h, [mw])` stays.
- Not changing `@rudderjs/server-hono`'s fetch-handler shape.

---

## Design

### New concept: route `group`

Every HTTP route has an optional `group: 'web' | 'api'` tag. When Hono composes the per-route chain, it prepends the matching group's middleware stack.

### Builder API

`withRouting` tags each loader with its group:

```ts
Application.configure({ ... })
  .withRouting({
    web:      () => import('../routes/web.ts'),       // group='web'
    api:      () => import('../routes/api.ts'),       // group='api'
    commands: () => import('../routes/console.ts'),
  })
  .withMiddleware((m) => {
    m.web(RateLimit.perMinute(60))     // applied to every web route
    m.api(RateLimit.perMinute(120))    // applied to every api route
    m.use(requestIdMiddleware)         // applied to EVERYTHING (legacy)
  })
  .create()
```

`m.web(...)` / `m.api(...)` appends to the named group's stack. `m.use(...)` remains — it means "all requests, no grouping" (backwards compatible).

### How grouping is propagated

When a loader runs, we wrap its execution in an AsyncLocalStorage marker so any `Route.get(...)` calls inside it tag themselves with the current group:

```ts
// Inside RudderJS._bootstrapProviders()
for (const loader of this._loaders) {
  await runWithGroup(loader.group, loader.fn)
}
```

`Route.get(path, h, [mw])` reads the ALS and stores `group` on the `RouteDefinition`. No change to user-facing route syntax.

### Provider install API

Providers stop calling `router.use(AuthMiddleware())`. Instead they push into a named group via a new core helper:

```ts
// Inside AuthProvider.boot()
appendToGroup('web', AuthMiddleware())
```

Session provider does the same:

```ts
// Inside SessionProvider.boot()
appendToGroup('web', sessionMiddleware(cfg))
```

Group registrations happen during provider `boot()`, then `_createHandler()` snapshots each group's stack.

### Hono composition

`HonoAdapter.registerRoute(route)` changes from:

```
per-route middleware → handler
```

to:

```
group middleware (if route.group is set) → per-route middleware → handler
```

Global middleware (from `m.use(...)`) still runs before both, via the existing `app.use('*')` path.

---

## Phase Breakdown

### Phase 1 — core plumbing

- Add `group?: 'web' | 'api'` to `RouteDefinition` in `@rudderjs/router`.
- Add an AsyncLocalStorage-backed `runWithGroup(group, fn)` + `currentGroup()` in `@rudderjs/router`.
- `Route.get/post/delete/...` reads `currentGroup()` and sets `route.group`.
- Update `withRouting` in `@rudderjs/core` to wrap each HTTP loader (`web`, `api`) with `runWithGroup`.

### Phase 2 — group middleware registry

- Add `MiddlewareConfigurator.web(...handlers)` and `.api(...handlers)` methods alongside existing `.use(...)`.
- `_createHandler()` resolves two group stacks (from `m.web/m.api` + provider pushes) and exposes them to the adapter via `setup(adapter)`.
- New adapter API: `adapter.applyGroupMiddleware(group, handler)` (analogous to `applyMiddleware`).

### Phase 3 — server-hono adapter

- `HonoAdapter.registerRoute(route)` composes `groupStack[route.group] ++ route.middleware` before invoking the handler.
- Global `m.use(...)` stays on `app.use('*')` — runs for all requests, unchanged.

### Phase 4 — auth + session migration

- `AuthProvider.boot()` — replace `router.use(AuthMiddleware())` with `appendToGroup('web', AuthMiddleware())`.
- `SessionProvider.boot()` — replace docs-only guidance with `appendToGroup('web', sessionMiddleware(cfg))`.
- Delete the manual `m.use(sessionMiddleware(configs.session))` from `playground/bootstrap/app.ts`.
- Delete manual `[SessionMiddleware()]` array from any remaining web routes now that it's auto-applied.

### Phase 5 — api-side safety net

- `req.user` on api routes is `undefined` (no AuthMiddleware ran). Routes that want bearer auth use `RequireBearer()` / `scope(...)` — unchanged.
- `Auth::user()` / `Auth.user()` inside an api handler without a bearer check returns `null` instead of throwing session errors. Small change in `AuthManager` / `SessionGuard.user()` — guard against missing session context → return `null`.

### Phase 6 — playground demo

- Confirm `/api/health`, `/api/passport/me`, `/api/tokens` continue to work.
- Confirm `/login`, `/dashboard`, `/logout` continue to work.
- Confirm that removing `sessionMiddleware` from `bootstrap/app.ts` (intentionally, as end state) no longer breaks API routes.

### Phase 7 — docs + CLAUDE.md + memory

- CLAUDE.md (root + auth + session) updates: explain web vs api groups, how providers install.
- Add a "Middleware groups" section to the architecture docs.
- Memory: replace the `feedback_session_is_load_bearing` pitfall (if saved) with the new model.

---

## Edge Cases

1. **Route with no group** — commands / channels / programmatically-registered routes outside `withRouting` loaders. Answer: `route.group` is undefined → only global `m.use(...)` middleware applies. No auth, no session. Safest default.

2. **Provider boots before `withMiddleware` runs** — provider pushes land in `groupStack` directly; `m.web(...)` / `m.api(...)` later appends. Order: providers first, then user config. (Same precedence as today: auth provider runs before user middleware config.)

3. **User wants both web and api on the same path** (e.g. `/users` serves both HTML and JSON by content-type). Answer: out of scope for v1. Users split into `/users` (web) + `/api/users` (api), which is already the convention.

4. **Opting a web route out of AuthMiddleware** — e.g. a public marketing page. Today this is implicit (auth just populates `req.user = null`). After the refactor, same behavior — AuthMiddleware is non-blocking; `RequireAuth()` is what blocks. No change.

5. **Package that wants to ship routes with its own group tag** — e.g. `@rudderjs/telescope` registers `/telescope/*` and wants no auth. Telescope already uses a custom router/mount path; it just needs to not sit under `runWithGroup('web', ...)`. Since telescope doesn't go through `withRouting.web`, it won't get tagged. ✓

6. **`@rudderjs/passport`'s `registerPassportRoutes(router)` call sits inside `routes/api.ts`** → api group → gets the api stack. That's correct: `/oauth/token` is stateless, `/oauth/authorize` wants a session for "who is approving". If the authorize endpoint needs the session guard, the user can put it in `routes/web.ts` instead, or `registerPassportRoutes` can attach session middleware to just the authorize routes itself. Decide in Phase 4.

---

## Verification Checklist

- [ ] `/api/health` works with `sessionMiddleware` removed from `bootstrap/app.ts`
- [ ] `/login` POST + `/dashboard` GET still work end-to-end
- [ ] `req.user` populated on `/dashboard` (web), `undefined` on `/api/health` (api)
- [ ] `req.user` populated on `/api/passport/me` via `RequireBearer()` (bearer, not session)
- [ ] `AuthMiddleware` runs once per web request, not twice
- [ ] Telescope records the correct middleware chain per request (web vs api should differ)
- [ ] `pnpm typecheck` clean across monorepo
- [ ] `pnpm test` passes for core, router, server-hono, auth, session, passport

---

## Risks

- **Behavior change for existing apps** — any app currently relying on auth/session running on `/api/*` will stop getting `req.user` there. Mitigation: note in changeset + README under "breaking" for v0.1 bump. (We're pre-1.0; this is the right time.)
- **Provider ordering** — if a user registers auth but not session, web routes 500 (same as today). Mitigation: `AuthProvider.boot()` already depends on session being registered; keep that check.
- **Cross-repo playgrounds** — pilotiq / pilotiq-pro playgrounds import `@rudderjs/core`. They'll need the same migration. Can be done in follow-up PRs since the refactor is additive (old `m.use(sessionMiddleware)` keeps working until those playgrounds delete it).

---

## Open Questions

1. Should `m.web(...)` / `m.api(...)` be the final names, or would `m.group('web', fn)` be clearer (allowing future custom groups)? Recommendation: ship `.web()/.api()` for Laravel parity; accept `m.group(name, ...mw)` as an escape hatch for forward-compat.
2. Do we want a `withoutMiddleware(['auth'])` per-route escape hatch (Laravel's `->withoutMiddleware(...)`)? Out of v1 scope; add later if the need surfaces.
3. Should `SessionGuard.user()` soft-fail on missing ALS context globally, or only when called from an api route? Recommendation: **always** soft-fail — it's a cheaper invariant and matches Laravel's `Auth::user()` semantics.
