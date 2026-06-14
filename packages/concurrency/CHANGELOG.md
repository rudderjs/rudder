# @rudderjs/concurrency

## 1.1.1

### Patch Changes

- baab617: Fix worker-pool lifecycle bugs that could wedge `Concurrency.run()` and leak workers/listeners. A worker that emitted an `error` (uncaught throw / unhandled rejection in the thread) was released back into the pool even though its thread was dead, so the next task dispatched to it never got a reply and `run()` (which uses `Promise.all`) hung forever; its `error` listener was also never removed, accumulating across tasks. The pool now discards a poisoned worker, spins up a replacement, and hands it to any waiter. A worker that exits before replying (a `process.exit()` in the task, a crash, or `terminate()` mid-task) is also handled now via an `exit` listener that rejects the pending task instead of hanging. `terminate()` additionally drains tasks parked in the acquire queue (rejecting them rather than leaving their promises unsettled), and `fake()` now terminates a previously auto-created worker driver before swapping in the sync driver so its pooled threads do not leak.

## 1.1.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

## 1.0.3

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

## 1.0.2

### Patch Changes

- 95e9f4a: Include `boost/` directory in npm tarball so `guidelines://<pkg>` MCP resources are available in installed apps.

## 1.0.1

### Patch Changes

- 1d4f50b: test: fill coverage gaps

  - `@rudderjs/view`: `view()` with no props defaults to `{}`, `isViewResponse(undefined)` returns `false`, `SafeString.toString()` returns the raw value.
  - `@rudderjs/localization`: `trans()` caching round-trip, `{0}` plural-branch resolution for `count = 0`, simple two-part pluralize fallback.
  - `@rudderjs/concurrency`: `defer()` swallows AND logs errors, `restore()` after `fake()` recreates the worker driver.

  No behavior changes — coverage only.

## 1.0.0

### Major Changes

- eda23b0: Graduate to 1.0.0. The `Concurrency` static facade — `Concurrency.run()` (parallel worker-pool dispatch), `Concurrency.defer()` (fire-and-forget), `Concurrency.fake()` / `Concurrency.restore()` (sync driver for testing) — is now part of the stable public API.

  Dogfooded in the playground via the Fibonacci demo (`/demos/fibonacci` → compute `fib(n)` N times sequentially vs in parallel via worker pool). Verified 5.7× speedup on `fib(38) × 8` (5293ms → 923ms) and 2.9× on `fib(36) × 4` (882ms → 307ms).

  **Breaking changes:**

  - Removed unused `ConcurrencyConfig` interface export. The interface was exported but never wired into any constructor or method — it had no functional effect. Pool size remains fixed at `os.cpus().length`. Runtime configuration can be added in 1.x if real users need it.

  **Docs refresh:**

  - README: added Common Pitfalls section (closure scope, structured-cloneable returns, defer error swallowing, Vite SSR + dist requirement, I/O-bound antipattern, fake state global) and Key Imports.
  - `boost/guidelines.md`: removed the dead `ConcurrencyConfig` import line — it didn't compile against an unconfigurable API.
  - Pool-size default + 1.0 config-API rationale documented in README.
