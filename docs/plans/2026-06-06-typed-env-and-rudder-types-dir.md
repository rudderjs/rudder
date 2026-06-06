# Typed Env + the `.rudder/types/` generated-types home

**Status**: ALL PHASES SHIPPED (release + rudderjs.com sync are post-merge follow-ups)
**Date**: 2026-06-06
**Context**: Generated-files discussion (items 1+2 shipped in #953). Item 3 — consolidating
generated type registries into one directory — was parked with a trigger condition: *the next
typed-X codegen feature lands together with the consolidation, so the migration buys a new
capability instead of being a reshuffle.* Typed env is that feature.

## Findings (verified 2026-06-06)

- **Typed `config()` already exists** — `packages/core/src/config.ts`: `AppConfig` empty
  interface + recursive `Paths`/`Get` dot-path types; `config('app.name')` is fully typed once
  the app augments `AppConfig`. The scaffolder already emits the augmentation
  (`create-rudder/src/templates/env.ts` → app `env.d.ts`). Gaps: **no guide documents it**, and
  the playgrounds predate the template (their `config()` calls fall to the loose overload).
- **`Env.get(key: string, fallback?: string): string`** (`packages/support/src/index.ts:6`) —
  no key typing, no autocomplete, typos surface at runtime as empty values.

## Phase 0 — quick wins (no codegen, independently shippable) — ✅ SHIPPED

1. ✅ Document typed `config()` — "Typed `config()`" section in the configuration guide +
   "The typed family" cross-link blocks on typed-views and typed-routes. Two findings made
   during writing: the loose overload also absorbs *mismatched fallbacks* (they degrade the
   call rather than erroring — documented as such), and core does not export `Paths`/
   `ConfigKey`, so no strict-wrapper recipe is documentable today (candidate type-only export
   for Phase 2, alongside `EnvRegistry`).
2. ~~Add the `AppConfig` augmentation to the playgrounds~~ — **stale finding**: all four
   playgrounds already carry `env.d.ts` + `export type Configs`, covered by the `*.ts`
   tsconfig include, and a negative probe confirmed the augmentation resolves (typed returns,
   `keyof AppConfig` populated). Nothing to do.
3. ✅ `.gitattributes` with `linguist-generated`: repo root (`**/`-prefixed patterns cover all
   playgrounds + `pnpm-lock.yaml`) and a new `gitattributes()` scaffolder template
   (create-rudder minor; snapshot baseline recaptured).

## Phase 1 — `.rudder/types/` home + consolidation (the item-3 trigger) — ✅ SHIPPED

Implementation deltas from the design below:

- **tsconfig include must be the glob form `".rudder/**/*"`** — the planned bare `".rudder"`
  does NOT work (verified by probe: tsc only auto-expands non-dotted directory includes).
  The doctor check specifically flags the bare form.
- `.rudder/README.md` is emitted by the **vite scanners only** (vite shares no workspace dep
  with database, so the models emitter can't reuse the helper; the path constant is
  duplicated in `schema-types.ts` with a keep-in-sync note).
- The views registry write moved from `generate()` into `syncViewsFromDisk()` and is now
  **unconditional** — previously a stale registry survived when the last view was deleted
  (generate()'s 0-views early return).
- Models legacy cleanup also rmdir's the emptied `app/Models/__schema/` directory.
- Decision 3 verified: nothing imports the views registry by path (`importPath` entries use
  the `App/Views/...` tsconfig alias — location-independent).

New committed directory, owned by the framework:

```
.rudder/
├── README.md            # generated; what each file is + regen commands
└── types/
    ├── views.d.ts       # ← was pages/__view/registry.d.ts
    ├── routes.d.ts      # ← was routes/__registry.d.ts (#953)
    ├── models.d.ts      # ← was app/Models/__schema/registry.d.ts
    └── env.d.ts         # NEW (Phase 2)
```

- **Vike page stubs do NOT move** — `pages/__view/**` is pinned by Vike's filesystem routing.
  Only the pure `.d.ts` augmentations consolidate.
- **tsconfig**: dot-dirs are invisible to TS `**/*` includes → scaffolder tsconfig gains
  `".rudder"` in `include`. Existing apps: one documented line (upgrade note + `rudder doctor`
  check that detects a `.rudder/` dir missing from tsconfig include).
- **Migration**: the #953 pattern — every emitter writes the new path and force-removes its
  legacy path. `schema-types.ts` (models), views scanner (registry only), routes scanner
  (again — accepts the double move; #953 shipped same-cycle so most apps never saw
  `routes/__registry.d.ts`).
- **Commit semantics unchanged**: `.rudder/` is committed (models registry needs a live DB;
  see directory-structure.md "Generated files"). `bootstrap/cache/` stays the gitignored home.
- Docs: rewrite the "Generated files" policy table for the new layout.

## Phase 2 — typed Env — ✅ SHIPPED

Implementation deltas from the design below:

- `getNumber`/`getBool`/`has` and the `env()` helper got the typed-first overload too, not
  just `Env.get` (the `Env` object is typed through an `EnvApi` interface — object literals
  can't carry overload signatures directly).
- Commented-out example keys (`# OPENAI_API_KEY=`) are deliberately NOT declared — they're
  optional suggestions, not contract.
- Missing `.env.example` removes a stale `env.d.ts` (symmetric shrink, like the views
  registry); apps without the file get zero `.rudder/` noise.
- `env:sync --fix` with no `.env` at all copies `.env.example` wholesale (comments included)
  instead of appending keys to an empty file.
- The playgrounds had NO `.env.example` (only secret `.env`) — authored placeholder ones for
  playground/playground-prisma/playground-rsc as part of dogfooding; playground-web has no
  env file at all and exercises the no-op path.
- The strict-wrapper type exports for `config()` (`ConfigKey`/`ConfigValue` from core) did
  NOT ride along — still a candidate for Phase 3 alongside the docs that would use them.

1. **`EnvRegistry`** empty interface in `@rudderjs/support` + `Env.get` overloads:
   ```ts
   get<K extends keyof EnvRegistry>(key: K, fallback?: string): string   // autocomplete + known keys
   get(key: string, fallback?: string): string                            // loose fallback (framework/packages)
   ```
   Loose overload stays — packages call `Env.get('REDIS_URL')` etc. for keys the app's
   `.env.example` doesn't declare. (Same name-loose/params-strict tension as `route()`; the
   strict wrapper recipe goes in the docs.)
2. **Scanner**: parse `.env.example` (committed truth — never `.env`, which is secret and
   absent in CI) → emit `.rudder/types/env.d.ts` augmenting `EnvRegistry`. All values typed
   `string` in v1 (runtime truth); no value parsing.
3. **`rudder env:sync`** (skip-boot CLI, lives with `routes:sync`):
   - regenerates `env.d.ts`
   - **diffs `.env` against `.env.example`** — flags missing keys; `--fix` appends them with
     example values (absorbs the parked DX-backlog `env:sync` idea — same command, two jobs)
4. **Dev watcher**: `@rudderjs/vite` watches `.env.example`, re-emits on change (exempt from
   the re-boot watcher like the routes registry).

## Phase 3 — docs + release — ✅ SHIPPED (docs side)

Implementation deltas:

- Typed Env documented as **sections in configuration.md** ("Typed Env" + "rudder env:sync"),
  not a separate page — it sits naturally next to the Env helper + the new typed-config()
  section; the typed-family blocks on typed-views/typed-routes grew to five entries.
- The Phase-0 candidate landed: **`ConfigKey` / `ConfigValue` are now exported from core**
  (main + /client, type-only, core minor) and the strict-wrapper recipe is documented + probe-verified.
- README: existing-example updates only (TypeScript-first highlight + bootstrap section line),
  per the showcase bar — no new section.
- Release (`pnpm release` via the changesets flow) + the rudderjs.com 4-step sync happen
  after the PRs merge — they're operational steps, not part of this PR.

- Guide: "Typed env & config" page (or section in configuration.md) joining the typed-views /
  typed-routes / typed-models family; README showcase candidate (existing-example update, not a
  new section).
- Changesets: support minor (EnvRegistry + overload), vite minor (scanner + consolidation),
  orm/database patch-or-minor (models registry path), create-rudder minor (tsconfig include,
  .gitattributes, env.d.ts), cli (env:sync loader entry).
- rudderjs.com sync after merge.

## Open decisions

1. `.rudder/` vs non-hidden `types/` — recommended `.rudder/` (no collision with user `types/`
   conventions; industry-shaped; room for future non-type artifacts). Cost: the tsconfig
   include line for existing apps.
2. Should `env:sync --fix` also REMOVE `.env` keys absent from `.env.example`? Recommended no
   (deletions are destructive; report-only).
3. Does the views registry move break anything that imports it by path? (It shouldn't — pure
   ambient augmentation — verify nothing references it explicitly.)
