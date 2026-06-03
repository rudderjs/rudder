# @rudderjs/process

## 1.1.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

## 1.0.3

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

## 1.0.2

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

## 1.0.1

### Patch Changes

- 95e9f4a: Include `boost/` directory in npm tarball so `guidelines://<pkg>` MCP resources are available in installed apps.

## 1.0.0

### Major Changes

- 1b3f873: Graduate to 1.0.0. The `Process` facade — `Process.run()`, `Process.command()`, `Process.start()`, `Process.pool()`, `Process.pipe()`, `Process.fake()` — plus the `PendingProcess` builder (`.path`, `.timeout`, `.env`, `.input`, `.quietly`, `.tty`, `.onOutput`), `ProcessResult`, `RunningProcess`, `ProcessPoolResult`, and `ProcessFailedException` are now part of the stable public API.

  Dogfooded in the playground via the system-info demo (`/demos/system-info` → `git rev-parse HEAD`, `node --version`, `uptime` running in parallel via `Process.pool()` with sequential-vs-parallel timing comparison).

  **Docs refresh:**

  - README: added Common Pitfalls section (shell injection, timeout units in seconds, non-zero-doesn't-throw semantics, pool vs pipe, huge-stdout memory, fake-state global) and Key Imports block.
  - `boost/guidelines.md`: corrected three fictional examples / claims:
    - Removed false "retries" claim from the overview — the package has no retry mechanism.
    - Fixed `.onOutput(chunk => ...)` examples to use the real signature `(type, data) => ...` (callback receives the stream type and data, not just a chunk).
    - Replaced "prefer array form via `Process.command([...])`" — `Process.command()` only accepts a string. Clarified that all commands are shell-parsed and user input must be escaped manually.
