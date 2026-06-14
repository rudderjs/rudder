# @rudderjs/terminal

## 1.2.1

### Patch Changes

- f0d1028: Fix `terminal()` misreporting a component's own ENOENT as "component not found". `resolveComponent`'s catch wrapped both the `fs.access` existence check and the dynamic `import()`, so an ENOENT thrown by the component module's own top-level code (e.g. a file it reads at import time being absent) was swallowed and replaced with a misleading "not found" error that hid the real bug. The existence check and the import are now separated so any error from the imported module propagates unchanged.

## 1.2.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

## 1.1.4

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

## 1.1.3

### Patch Changes

- bdfb88c: Fix `make:terminal` generating a broken component (found by dogfooding).

  `pnpm rudder make:terminal <Name>` wrote `app/Terminal/<Name>Terminal.ts` — a `.ts` file containing JSX (Ink), which doesn't compile, with a spurious `Terminal` suffix that the `terminal('id')` resolver (`'dashboard'` → `app/Terminal/Dashboard.tsx`) could never find. So scaffolded terminal components neither compiled nor resolved.

  - `@rudderjs/console` — `MakeSpec` gains an optional `extension` field (defaults to `ts`); `executeMakeSpec` honors it. Lets a stub opt into `tsx` (or any extension) instead of the hardcoded `.ts`.
  - `@rudderjs/terminal` — `makeTerminalSpec` now sets `extension: 'tsx'` and drops the `Terminal` suffix, so `make:terminal Dashboard` produces `app/Terminal/Dashboard.tsx` — which compiles and is resolvable by `terminal('dashboard')`, matching the documented behavior.

## 1.1.2

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

## 1.1.1

### Patch Changes

- 7eab2d2: Author `boost/guidelines.md` for the 6 packages that previously had no boost content. Adopting apps now get per-package guidelines for these packages too — `@rudderjs/boost` was already capable of consuming them, only the source content was missing.

  Also adds `"boost"` to the `files` array in `package.json` for the 5 packages that didn't include it (`@rudderjs/terminal` already did), so the guidelines actually ship via npm.

  No code changes.

## 1.1.0

### Minor Changes

- 31d0c31: Add `@rudderjs/terminal` — `terminal('id', props)` renders Ink/React components from `app/Terminal/` in rudder commands, mirroring the `view()` ergonomics for the browser. Also adds `make:terminal` scaffolder to `@rudderjs/cli`.
