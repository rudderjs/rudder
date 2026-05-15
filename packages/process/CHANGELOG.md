# @rudderjs/process

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
