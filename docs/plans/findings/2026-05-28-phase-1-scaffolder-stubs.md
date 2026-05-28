# Phase 1 Findings — Scaffolder stub audit

> Plan: `docs/plans/2026-05-28-quality-dx-sweep.md`
> Date: 2026-05-28
> Investigator: Claude (executing Phase 1 read-only audit)
> Pre-flight: #726 (today) fixed `make:terminal` extension/suffix; the resulting
> shape (`extension?: 'tsx'`, `MakeSpec` in `@rudderjs/console`) is the reference
> model for everything below. Findings below are NEW — not re-findings of #726.

---

## Inventory

The scaffolder universe is bigger than the original "MakeSpec" model implies —
**two** registration paths exist with different feature sets:

- **CLI-owned legacy path** — `packages/cli/src/commands/make/_shared.ts`'s
  `registerMake()`. Hard-codes `.ts` extension (no `extension` field).
  Used by 10 commands.
- **`MakeSpec` path** — `packages/console/src/make.ts`'s `registerMakeSpecs()` +
  `executeMakeSpec()`. Supports `extension` field (default `'ts'`).
  Used by 9 commands across package-owned scaffolders.
- **Bespoke** — 2 commands implement their own writeFile/mkdir loop and don't
  use either helper: `make:module` and `make:migration`.

Two additional commands are referenced in docs but **not implemented**:
`make:notification` (mentioned in `docs/guide/notifications.md:74` and
`docs/guide/rudder.md:131`) and `make:resource` (mentioned in
`docs/plans/2026-05-21-dx-quick-wins-roadmap.md`).

One additional command is **registered but unreachable**: `make:passport-client`
(registered inside `PassportProvider.boot()` — but `make:*` argv skips boot, so
the command is never wired into Commander before help lookup).

| Command | Package | Registration path | Target path pattern | Extension | Stub source file |
|---|---|---|---|---|---|
| `make:controller` | `@rudderjs/cli` | legacy `registerMake` | `app/Http/Controllers/<Name>Controller.ts` | `.ts` (hard-coded) | `packages/cli/src/commands/make/controller.ts` |
| `make:model` | `@rudderjs/cli` | legacy `registerMake` | `app/Models/<Name>.ts` | `.ts` (hard-coded) | `packages/cli/src/commands/make/model.ts` |
| `make:job` | `@rudderjs/cli` | legacy `registerMake` | `app/Jobs/<Name>.ts` | `.ts` (hard-coded) | `packages/cli/src/commands/make/job.ts` |
| `make:middleware` | `@rudderjs/cli` | legacy `registerMake` | `app/Http/Middleware/<Name>Middleware.ts` | `.ts` (hard-coded) | `packages/cli/src/commands/make/middleware.ts` |
| `make:request` | `@rudderjs/cli` | legacy `registerMake` | `app/Http/Requests/<Name>Request.ts` | `.ts` (hard-coded) | `packages/cli/src/commands/make/request.ts` |
| `make:provider` | `@rudderjs/cli` | legacy `registerMake` | `app/Providers/<Name>ServiceProvider.ts` | `.ts` (hard-coded) | `packages/cli/src/commands/make/provider.ts` |
| `make:command` | `@rudderjs/cli` | legacy `registerMake` | `app/Commands/<Name>.ts` | `.ts` (hard-coded) | `packages/cli/src/commands/make/command.ts` |
| `make:event` | `@rudderjs/cli` | legacy `registerMake` | `app/Events/<Name>.ts` | `.ts` (hard-coded) | `packages/cli/src/commands/make/event.ts` |
| `make:listener` | `@rudderjs/cli` | legacy `registerMake` | `app/Listeners/<Name>.ts` | `.ts` (hard-coded) | `packages/cli/src/commands/make/listener.ts` |
| `make:mail` | `@rudderjs/cli` | legacy `registerMake` | `app/Mail/<Name>.ts` | `.ts` (hard-coded) | `packages/cli/src/commands/make/mail.ts` |
| `make:agent` | `@rudderjs/ai` | `MakeSpec` | `app/Agents/<Name>Agent.ts` | `.ts` (default) | `packages/ai/src/commands/make-agent.ts` |
| `make:terminal` | `@rudderjs/terminal` | `MakeSpec` | `app/Terminal/<Name>.tsx` | `.tsx` (explicit) | `packages/terminal/src/commands/make-terminal.ts` |
| `make:factory` | `@rudderjs/orm` | `MakeSpec` | `app/Factories/<Name>Factory.ts` | `.ts` (default) | `packages/orm/src/commands/make-factory.ts` |
| `make:seeder` | `@rudderjs/orm` | `MakeSpec` | `database/seeders/<Name>Seeder.ts` | `.ts` (default) | `packages/orm/src/commands/make-seeder.ts` |
| `make:mcp-server` | `@rudderjs/mcp` | `MakeSpec` | `app/Mcp/Servers/<Name>Server.ts` | `.ts` (default) | `packages/mcp/src/commands/make-mcp-server.ts` |
| `make:mcp-tool` | `@rudderjs/mcp` | `MakeSpec` | `app/Mcp/Tools/<Name>Tool.ts` | `.ts` (default) | `packages/mcp/src/commands/make-mcp-tool.ts` |
| `make:mcp-resource` | `@rudderjs/mcp` | `MakeSpec` | `app/Mcp/Resources/<Name>Resource.ts` | `.ts` (default) | `packages/mcp/src/commands/make-mcp-resource.ts` |
| `make:mcp-prompt` | `@rudderjs/mcp` | `MakeSpec` | `app/Mcp/Prompts/<Name>Prompt.ts` | `.ts` (default) | `packages/mcp/src/commands/make-mcp-prompt.ts` |
| `make:passport-client` | `@rudderjs/passport` | `MakeSpec` via provider `boot()` | `app/Seeders/<Name>.ts` | `.ts` (default) | `packages/passport/src/index.ts:240-260` |
| `make:migration` | `@rudderjs/orm` | bespoke (shells out to Prisma/Drizzle) | varies by ORM | varies | `packages/orm/src/commands/migrate.ts:376` |
| `make:module` | `@rudderjs/cli` | bespoke (5-file writer + provider auto-register) | `app/Modules/<Name>/<Name>{Schema,Service,ServiceProvider,test,prisma}.ts` | `.ts` / `.prisma` | `packages/cli/src/commands/module/make.ts:167` |
| `make:notification` | — (NOT IMPLEMENTED) | — | docs say `app/Notifications/<Name>Notification.ts` | — | none — referenced in docs only |
| `make:resource` | — (NOT IMPLEMENTED) | — | unclear (API resource? Eloquent resource?) | — | none — referenced in plan docs only |

---

## Rubric

Each stub must satisfy:

1. **Filename correctness** — the generated path must match the documented
   runtime resolver pattern. E.g.: `terminal('id')` → `app/Terminal/<Id>.{tsx,ts}`,
   `view('id')` → `app/Views/<Id>.tsx`, jobs/models by class name. A
   `Foo` suffix appended where the resolver doesn't expect it is a 🔴.
2. **Extension correctness** — JSX-bearing stubs must use `.tsx` (`MakeSpec.extension: 'tsx'`).
   A pure-TS stub may use `.ts`. JSX in `.ts` = 🔴 (won't compile).
3. **Compiles** — generated file passes `pnpm typecheck` in the playground
   immediately after scaffolding, with no other state change.
4. **Resolves at runtime** — `view('id')` / `terminal('id')` / `dispatch(JobClass)` /
   etc. all find the generated artifact without further rename.
5. **Matches docs** — the documented usage example in `docs/guide/*.md`
   actually works against the generated stub (signature, imports, body).

---

## Static-analysis findings

### 🔴 broken

**(SA-1) `make:controller` — imports a non-existent type `Context` from `@rudderjs/core`**
- File: `packages/cli/src/commands/make/controller.ts`
- Lines emitted with broken import: `9` (plain stub), `28` (resource), `45` (api), `60` (singleton) — **all four stub variants are affected**.
- `@rudderjs/core` does not export `Context` (verified against `packages/core/src/index.ts:1-105`). The only `Context` value in the framework is the **Laravel-style state facade** at `packages/context/src/index.ts:58` (i.e. `@rudderjs/context`'s `Context` class) — semantically different from the per-request "controller context" the stub implies.
- The correct path here is to drop the import altogether: `@rudderjs/router`'s decorators don't pass any "context" object to handler methods (they receive `req`/`res` if declared via parameter injection). For a parameterless handler the stub should declare `async index()` without an unused argument.

### 🔴 likely broken

**(SA-2) `make:factory` — generated definition shape is inferred against a model that has no field types**
- File: `packages/orm/src/commands/make-factory.ts:29-32`
- Stub emits `extends ModelFactory<{ name: string; email: string }>` with a hardcoded shape that's intended to be edited.
- When paired with `make:model X` (which emits a model whose fields are unknown), `protected modelClass = X` triggers `TS2416` because the factory's shape doesn't match the model's typed `attributes` shape. Verified in E2E pass (see E2E-1 below). Static analysis flag: stub emits two coupled artifacts whose typing only matches if the user manually edits both.

### 🔴 reachability bug

**(SA-3) `make:passport-client` — registered inside provider `boot()`; `make:*` argv skips boot**
- Registration site: `packages/passport/src/index.ts:240-260` inside `PassportProvider.boot()`.
- The CLI's skip-boot logic at `packages/cli/src/index.ts:374` (`NO_BOOT_PREFIX = ['make:']`) returns true for `make:passport-client`, so `bootApp()` is bypassed and `PassportProvider.boot()` never runs, so the spec is never registered with `@rudderjs/console`'s registry, so `makeCommand()` at `packages/cli/src/commands/make.ts:29` never sees it.
- End-to-end visible failure: `pnpm rudder make:passport-client <Name>` prints the top-level help (Commander treats `make:passport-client` as an unknown command) instead of scaffolding the seeder.
- Two viable fixes: (a) move the spec into a `commands/make-passport-client.ts` subpath of `@rudderjs/passport` and add a loader entry in `packages/cli/src/index.ts:170-254` alongside the other package loaders (the doc-blessed pattern per `packages/cli/CLAUDE.md` "Package commands"); or (b) drop the spec into `passport/src/commands/make-passport-client.ts` + export from `@rudderjs/passport/commands/make-passport-client` and follow the same wiring as `make:agent`/`make:terminal`/`make:mcp-*`.

### 🟡 drift

**(SA-4) `make:module` — generated `bootstrap/providers.ts` import uses a relative path instead of the existing `App/...` TSConfig alias**
- File: `packages/cli/src/commands/module/make.ts:140-162` (the `autoRegisterProvider` helper that injects an `import` line).
- The other imports in `playground/bootstrap/providers.ts` use `App/Providers/...` / `App/Events/...` / `App/Listeners/...` (verified after running `pnpm rudder make:module`). The auto-registered line is `import { ... } from '../app/Modules/<Name>/<Name>ServiceProvider.js'` — works at runtime, but stylistically drifts from the file's other imports. Non-blocking; cosmetic.

**(SA-5) `make:notification` and `make:resource` are documented but not implemented**
- `docs/guide/notifications.md:74` advertises `pnpm rudder make:notification Welcome` — no spec exists for this command across any framework package (grep `'make:notification'` across `packages/*/src` returns zero matches).
- `docs/guide/rudder.md:131` lists `make:notification` in the canonical scaffolder set.
- `make:resource` is referenced in `docs/plans/2026-05-21-dx-quick-wins-roadmap.md:97` and `:133` as part of an already-considered DX phase but was never shipped.
- These are missing scaffolders, not stub bugs — but the docs imply they exist. Either ship them or scrub the docs.

### 🟢 clean (static analysis only — see E2E for compile verdict)

- `make:model` — `Model` import is real, table-name derivation is correct.
- `make:job` — `Job` import is real, no JSX, no suffix-mismatch concerns.
- `make:middleware` — `Middleware` + `AppRequest`/`AppResponse` imports all exist; `Middleware` suffix matches Laravel conv.
- `make:request` — `FormRequest`/`z` are both exported from `@rudderjs/core` (verified line 45).
- `make:provider` — `ServiceProvider` is exported (verified line 23). `ServiceProvider` suffix is correct.
- `make:command` — `Command` is re-exported from `@rudderjs/core` (verified line 50) and also from `@rudderjs/console`.
- `make:event` — empty class shell, no imports to break.
- `make:listener` — `Listener` is exported from `@rudderjs/core` (verified line 38).
- `make:mail` — `Mailable` is exported from `@rudderjs/mail` (verified).
- `make:agent` — `Agent`, `HasTools`, `AnyTool` are exported from `@rudderjs/ai` (verified line 116; `HasTools` & `AnyTool` are tool/agent types).
- `make:terminal` — JSX in `.tsx`; suffix-free filename matches `terminal('id')` resolver at `packages/terminal/src/resolve.ts:22-30` (#726's fix).
- `make:seeder` — `Seeder` is exported from `@rudderjs/orm`; `database/seeders/` matches the runner's discovery path.
- `make:mcp-server` / `make:mcp-tool` / `make:mcp-resource` / `make:mcp-prompt` — all use decorators (`@Name`, `@Version`, `@Description`); imports map to real exports.

---

## End-to-end findings

Method: from `playground/` (clean working tree), `pnpm rudder make:<cmd> AuditTest`,
then `pnpm typecheck`, then reset via `git checkout app/ && git clean -fd app/`
(extending to `database/seeders/` or `bootstrap/` for commands that touch those).

### 🔴 broken

**(E2E-1) `make:controller` — all four variants emit code that fails `pnpm typecheck`**
- Plain stub:
  ```
  $ pnpm rudder make:controller AuditTest
    ✔ Controller created: app/Http/Controllers/AuditTestController.ts
  $ pnpm typecheck
  app/Http/Controllers/AuditTestController.ts(2,15): error TS2305:
    Module '"@rudderjs/core"' has no exported member 'Context'.
  ```
- `--resource`: same error (line 1, position 15).
- `--api`: same error (line 1, position 15).
- `--singleton`: same error (line 1, position 15).
- Maps to SA-1.

**(E2E-2) `make:factory` paired with `make:model` of the same name — TS2416 because the factory's typed generic doesn't match the empty model class**
- Sequence:
  ```
  $ pnpm rudder make:model AuditTest
    ✔ Model created: app/Models/AuditTest.ts
  $ pnpm rudder make:factory AuditTest
    ✔ Factory created: app/Factories/AuditTestFactory.ts
  $ pnpm typecheck
  app/Factories/AuditTestFactory.ts(9,13): error TS2416:
    Property 'modelClass' in type 'AuditTestFactory' is not assignable
    to the same property in base type
    'ModelFactory<{ name: string; email: string; }>'.
  ```
- Standalone `make:factory AuditTest` (without the model) emits a `TS2307`
  for the missing model import, which is the expected "edit the import to point
  at your real model" guidance documented in the stub comments. The TS2416 case
  is the more interesting bug — pairing the two scaffolders that are most
  likely to be used together produces something that doesn't compile.
- Maps to SA-2.

**(E2E-3) `make:passport-client` — silently unreachable; prints top-level help**
- Sequence:
  ```
  $ pnpm rudder make:passport-client AuditTest
  > rudderjs-playground@0.0.115 rudder /Users/sleman/Projects/rudder/playground
  > tsx node_modules/@rudderjs/cli/src/index.ts make:passport-client AuditTest

    Rudder Framework 4.6.7

    Usage:
      command [options] [arguments]

    Available commands:
      add                   Install a RudderJS package — ...
      ...
  ```
- No file is created; no error is reported; exit code is 0. The user has no
  signal that the command they ran is registered-but-unreachable vs.
  doesn't-exist. Maps to SA-3.

### 🟢 clean

The following commands generate compiling code that resolves at the expected
path (verified via `pnpm typecheck` and filesystem walk; runtime resolver
check skipped where it would require booting + invoking the resolver, which
the test budget didn't include):

- `make:model AuditTest` → `app/Models/AuditTest.ts` — clean.
- `make:job AuditTest` → `app/Jobs/AuditTest.ts` — clean.
- `make:middleware AuditTest` → `app/Http/Middleware/AuditTestMiddleware.ts` — clean.
- `make:request AuditTest` → `app/Http/Requests/AuditTestRequest.ts` — clean.
- `make:provider AuditTest` → `app/Providers/AuditTestServiceProvider.ts` — clean.
- `make:command AuditTest` → `app/Commands/AuditTest.ts` — clean; afterCreate hint printed.
- `make:event AuditTest` → `app/Events/AuditTest.ts` — clean.
- `make:listener AuditTest` → `app/Listeners/AuditTest.ts` — clean.
- `make:mail AuditTest` → `app/Mail/AuditTest.ts` — clean.
- `make:agent AuditTest` → `app/Agents/AuditTestAgent.ts` — clean.
- `make:seeder AuditTest` → `database/seeders/AuditTestSeeder.ts` — clean.
- `make:mcp-server AuditTest` → `app/Mcp/Servers/AuditTestServer.ts` — clean.
- `make:mcp-tool AuditTest` → `app/Mcp/Tools/AuditTestTool.ts` — clean.
- `make:mcp-resource AuditTest` → `app/Mcp/Resources/AuditTestResource.ts` — clean.
- `make:mcp-prompt AuditTest` → `app/Mcp/Prompts/AuditTestPrompt.ts` — clean.
- `make:terminal AuditTest` → `app/Terminal/AuditTest.tsx` — clean (extension/filename per #726).
- `make:module AuditTest` → `app/Modules/AuditTest/<5 files>` — clean (typecheck passes; auto-registered provider import works; SA-4 is the only nit).

### Not tested (out of scope or impractical)

- **`make:migration`** — delegates to `prisma migrate dev --create-only --name <name>`; on the playground's current SQLite state Prisma demanded a schema reset before writing the new migration file. Not a stub bug — the migration command works in the sense that the stub doesn't exist (Prisma owns the file). Skipped without prejudice.
- **Runtime resolver invocations** — booting the app and invoking
  `view('audit-test')` / `terminal('audit-test')` / `dispatch(new AuditTest)` /
  etc. against each generated artifact. The static + typecheck signal is
  strong enough that the missing E2E coverage is not blocking; queue as a
  follow-up under "Out-of-scope / deferred" below.

---

## Recommended fix clusters

Grouped by **root cause**, not by file count.

### Cluster A: `make:controller` `Context` import — 1 PR, 1 changeset, touches 1 file

- Root cause: SA-1 / E2E-1.
- Scope: edit `packages/cli/src/commands/make/controller.ts` to remove the
  broken `import type { Context } from '@rudderjs/core'` line and adjust
  the four handler signatures (`_ctx: Context` → drop the unused param,
  or rename and type via the router's actual handler-arg conventions).
- Risk: low. Only the four stub-emitter functions change.
- TDD lock: add a test that scaffolds each of the 4 variants, runs
  `tsc --noEmit` against the result, asserts no diagnostics.
- Changeset: `patch` on `@rudderjs/cli`.

### Cluster B: `make:passport-client` reachability — 1 PR, ~2 changesets, ~3 files

- Root cause: SA-3 / E2E-3.
- Scope: relocate the spec to `packages/passport/src/commands/make-passport-client.ts`
  (exported), add a `tryImport('@rudderjs/passport', 'commands/make-passport-client')`
  entry in `packages/cli/src/index.ts:170-254`, declare the new subpath in
  `packages/passport/package.json#exports`. Remove the in-`boot()` registration.
- Risk: low. The spec object itself doesn't change; only its delivery path.
- TDD lock: assert `pnpm rudder make:passport-client TestClient` from a
  fresh playground exits 0 and writes the expected file.
- Changeset: `patch` on `@rudderjs/passport`; `patch` on `@rudderjs/cli`.

### Cluster C: `make:factory` typed-generic mismatch — 1 PR, 1 changeset, 1 file

- Root cause: SA-2 / E2E-2.
- Scope: rethink the factory stub's typed generic. Two viable shapes:
  (a) emit `extends ModelFactory<InstanceType<typeof <Model>>>` so the shape
  is inferred from the model; (b) drop the explicit generic argument and let
  TS infer from `protected modelClass`. Either way, the stub should compile
  the moment a `make:model X; make:factory X` pair lands.
- Risk: low; cosmetic-ish — `ModelFactory<T>` is the source of truth.
- TDD lock: scaffold the model+factory pair, `tsc --noEmit`, expect zero
  diagnostics.
- Changeset: `patch` on `@rudderjs/orm`.

### Cluster D (deferred — see "Out-of-scope" below): `make:notification` + `make:resource` — implement OR scrub docs

- Root cause: SA-5.
- Choose: ship the scaffolders OR remove the doc references. New scaffolders
  are `feat:` work (minor bumps + Phase-1's "no new public API" implicit
  budget). User decision — not a default fix-cluster recommendation here.

### Cluster E (cosmetic): `make:module` provider-import path normalization — 1 small PR if user wants it

- Root cause: SA-4.
- Scope: change `autoRegisterProvider`'s emitted import from
  `'../app/Modules/<Name>/<Name>ServiceProvider.js'` to
  `'App/Modules/<Name>/<Name>ServiceProvider.js'` (matches the other imports
  in the generated `bootstrap/providers.ts`).
- Risk: trivial. Cosmetic. Only consider shipping if a Cluster A/B/C PR is
  already touching `@rudderjs/cli` so this lands "for free."

---

## Out-of-scope / deferred

- **Runtime-resolver E2E coverage** — booting the app per scaffolded artifact
  and invoking the documented resolver (`view()` / `terminal()` / `dispatch()`).
  Static + typecheck signal was sufficient for the bugs surfaced; revisit if
  Cluster C or D motivates broader E2E.
- **`make:notification` / `make:resource` implementations** — these are
  scaffolder-implementation work, not stub-quality fixes; deferred to a
  separate scoping discussion (Cluster D).
- **Unifying the two scaffolder registration paths** (`registerMake` legacy
  vs `MakeSpec`) — `_shared.ts:33-62` is a parallel implementation of
  `make.ts:33-84` with `extension` support intentionally omitted. None of the
  CLI-owned stubs need JSX today, so the duplication is benign; consider a
  refactor only if a future CLI-owned scaffolder needs `.tsx` output. **Not
  recommended in Phase 1** — refactor without a forcing function.
- **`make:passport-client` provider-time afterCreate semantics** — when the
  spec moves to a CLI-loader subpath (Cluster B), the registration loses
  whatever provider-state context `PassportProvider.boot()` could have given
  it. In practice the spec just writes a file — no provider state is read.
  Verify on impl; flag as a separate finding if surprises emerge.

---

## Overall assessment

`make:*` is **broadly healthy** — 17 of 22 commands emit code that compiles
and lands at the documented path on first try. Two clusters of real bugs
account for the brokenness: (1) `make:controller`'s stale `Context` import
breaks all 4 of its variants (1 cluster), and (2) `make:passport-client` is
registered through a code path the CLI's skip-boot logic deliberately bypasses,
making it silently unreachable (1 cluster). A third issue — `make:factory`'s
typed-generic mismatch — is real but milder (it bites the model+factory pair
specifically, which is the most common usage). Two more commands
(`make:notification`, `make:resource`) are advertised in docs but missing
entirely. Beyond those, the cosmetic drift in `make:module`'s provider-import
emit is the only remaining nit. Phase 1's plan-stated "structural" risk class
(`#726`-shape: wrong extension / wrong filename) is **not present anywhere
else**; the live bugs are import-correctness and reachability, both narrower
classes than #726.
