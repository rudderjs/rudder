# @rudderjs/cli

## 4.2.0

### Minor Changes

- 343c96d: **Boost: `commands_list` + `command_run` MCP tools.** Agents can now discover and execute rudder commands directly from MCP — no more shelling out blindly.

  - `commands_list` returns built-in + package + user-defined commands with names, descriptions, args, options, and source. Optional `namespace` filter (e.g. `make`, `db`, `queue`).
  - `command_run` spawns a command as a subprocess, captures stdout/stderr/exit code/duration, enforces a timeout, and caps stream sizes. Subprocess isolation keeps the long-lived MCP server clean.
  - The CLI's `command:list` gains `--all` (include built-in + package commands) and `--json` (machine-readable output) flags. When the user app cannot boot, `command:list --json` still emits built-in + package commands plus a `bootError` field rather than crashing — partial info beats an opaque failure for an agent mid-session.

### Patch Changes

- f06331e: **A5 Phase 2 — `pnpm rudder ai:eval` CLI + JSON reporter.** Phase 1 shipped the eval framework; Phase 2 makes it a first-class command. The CLI walks `evals/**/*.eval.ts` (override via `config('ai').eval.pattern`), runs each suite serially, and reports pass/fail + cost + tokens.

  - **Console mode** (default) — uses Phase 1's `reportConsole` per suite.
  - **`--json`** — emits a `{ suites: [{ suite, passed, failed, cases: [{ name, status, pass, score?, reason?, tokens, cost, duration }] }] }` envelope to stdout. CI scripts can pipe directly into `jq`; matches the `command_run` MCP tool envelope shape so the boost agent surface and the eval CLI feel like one family.
  - **`--bail`** — stop on the first failing suite. Pairs with `--json` so a failing CI run streams the first failure without waiting for the rest.
  - **Positional name filter** — `pnpm rudder ai:eval support` runs only suites whose `name` includes `'support'` (case-insensitive substring).

  Exits 0 when every case passes, 1 otherwise (also 1 when no suites match in console mode; `--json` always exits 0 with an empty envelope so `jq` consumers don't crash).

  Phase 3 adds `jsonShape`/`semanticMatch`/`tokenCost` metrics; Phase 4 adds `--record`/`--replay` (AiFake-backed) + telescope `agent.eval.completed` events; Phase 5 adds the HTML report.

## 4.1.1

### Patch Changes

- 31d0c31: Add `@rudderjs/terminal` — `terminal('id', props)` renders Ink/React components from `app/Terminal/` in rudder commands, mirroring the `view()` ergonomics for the browser. Also adds `make:terminal` scaffolder to `@rudderjs/cli`.

## 4.1.0

### Minor Changes

- 5447fa9: Add `FormRequest` lifecycle hooks (Laravel parity #6).

  `FormRequest` now supports five optional protected methods that mirror Laravel's lifecycle:

  - `prepareForValidation(input)` — mutate merged input pre-parse (sync). Lowercase emails, trim strings, etc.
  - `messages()` — per-request error message overrides keyed by dot-path. Static string or `(issue) => string`.
  - `after()` — array of cross-field check closures with `addError(path, msg)`. Run serially after parse; all errors collected in one round-trip.
  - `passedValidation(data)` — final transform on parsed data (sync or async); return value replaces resolved data.
  - `failedValidation(errors)` — override the throw. Default throws `ValidationError`; return a Web `Response` to short-circuit (wrapped in a new `ValidationResponse` sentinel that the framework's exception handler unwraps).

  Existing `FormRequest` subclasses keep working unchanged — the hooks have empty default implementations.

  The `make:request` stub now includes commented-out hook signatures to aid discovery.

- 5703439: Pruning — `Prunable` / `MassPrunable` markers + `pnpm rudder model:prune` (Laravel parity #2 plan #8).

  Models declaring `static prunable()` are picked up by the new `model:prune` command. Default `pruneMode = 'instance'` re-queries each chunk and calls `instance.delete()` per row — soft-deletes apply, `deleting` / `deleted` observers fire, optional `static pruning(model)` runs first. `pruneMode = 'mass'` (`MassPrunable`) runs a single `qb.deleteAll()` per chunk — no observers, no hooks, soft-deletes bypassed (mirrors the existing bulk-delete primitive).

  CLI flags: `--model=A,B`, `--except=A`, `--chunk=N`, `--pretend`. Schedule it with `scheduler.command('model:prune').daily()` — first-class retention hook with zero per-model wiring.

  Programmatic entry: `pruneModels({ models?, except?, chunk?, pretend? })` returns one `{ model, mode, count }` report per pruned model. Re-queries instead of `offset()` paging because deletions shift the cursor.

### Patch Changes

- ca63e78: Add Laravel-style `Route::resource` / `apiResource` / `singleton` to `@rudderjs/router` and `make:controller --resource`/`--api`/`--singleton` flags to `@rudderjs/cli` (Laravel parity #5, PR3 of 3).

  **Public API on `Router`:**

  - `router.resource(name, Ctrl, opts?)` — registers the seven canonical RESTful routes (`index`/`create`/`store`/`show`/`edit`/`update`/`destroy`). The `update` route is registered for both `PUT` and `PATCH` at the same path.
  - `router.apiResource(name, Ctrl, opts?)` — same as `resource` but skips `create` + `edit` (no HTML form pages).
  - `router.singleton(name, Ctrl, opts?)` — registers `show`/`edit`/`update` only. The returned `SingletonRegistration` exposes `.creatable()` (adds `GET /<name>/create` + `POST /<name>`) and `.destroyable()` (adds `DELETE /<name>`).

  ```ts
  class PostController {
    async index(ctx) {
      /* … */
    }
    async show(ctx) {
      /* … */
    }
    async store(ctx) {
      /* … */
    }
    // …
  }

  router.resource("posts", PostController);
  router.apiResource("posts", PostController, { only: ["index", "show"] });
  router.singleton("profile", ProfileController).creatable().destroyable();
  ```

  **Controller convention:** plain class, no decorators. Methods are matched by name to the canonical verbs. **Methods the controller doesn't implement are silently skipped** — a controller with only `index`/`show` works without an `only` or `except` filter.

  **`ResourceOptions`:** `only`, `except`, `parameters` (override `:param` segment name), `names` (override generated route names), `middleware`.

  **Default route names:** `<resource>.<verb>` (e.g. `posts.index`, `posts.show`). Default `:param` name is a naive singular of `name` (`posts → post`, `categories → category`, `boxes → box`); irregular plurals must use the `parameters` option.

  **Per-route customisation:** the returned `ResourceRegistration` exposes the underlying `RouteBuilder[]` in declaration order. Apply `where*()` or per-route middleware to a single verb without affecting the rest:

  ```ts
  const reg = router.resource("posts", PostController);
  reg.builders[3].whereNumber("post"); // constrain show route only
  ```

  **Scaffolder support:** `make:controller` accepts three mutually-exclusive flags:

  ```bash
  pnpm rudder make:controller PostController --resource     # full 7-verb plain class
  pnpm rudder make:controller PostController --api          # 5-verb (no create/edit)
  pnpm rudder make:controller ProfileController --singleton # show/edit/update only
  ```

  Default `make:controller` (no flag) still emits the decorator-based stub.

  This completes the router parity sweep (#5). PR1 added `where*()` constraints; PR2 added `router.group()` / subdomain routing / `.missing()`. No changes to the public surface of any other package.

  **Internal note:** `MakeSpec.stub` callback now receives the parsed CLI opts as a second argument (`(className, opts) => string`), enabling per-flag stub dispatch. Existing single-arg callbacks continue to type-check.

- Updated dependencies [6c03c74]
- Updated dependencies [3ccac5d]
- Updated dependencies [5447fa9]
- Updated dependencies [a0b96f9]
- Updated dependencies [ca63e78]
- Updated dependencies [fcca26b]
  - @rudderjs/core@1.1.0
  - @rudderjs/router@1.1.0

## 4.0.2

### Patch Changes

- 1d81533: Graduate `@rudderjs/console` to 1.0.0.

  The command registry (`Rudder` / `rudder`), `CommandBuilder` chain, `Command` abstract class (with argument/option accessors, output helpers `info`/`error`/`warn`/`line`/`comment`/`newLine`/`table`, and prompt helpers `ask`/`confirm`/`choice`/`secret`), `parseSignature()`, the `MakeSpec` scaffolder pipeline (`registerMakeSpecs`/`getMakeSpecs`/`executeMakeSpec`), and the `CommandObserverRegistry` are now stable.

  `CliError` moves from `@rudderjs/cli` to `@rudderjs/console`. `@rudderjs/cli` keeps re-exporting it for backwards compatibility, so `import { CliError } from '@rudderjs/cli'` continues to work — but new code should import from `@rudderjs/console` (where the rest of the command primitives live).

  Boost guidelines were corrected — prior versions documented prompt methods (`prompt`, `select`, `multiselect`, `success`) that don't exist on the `Command` class. The real names are `ask`, `choice`, `info`.

- Updated dependencies [1d81533]
  - @rudderjs/console@1.0.0
  - @rudderjs/core@1.0.1

## 4.0.1

### Patch Changes

- 8689218: **`@rudderjs/horizon`** — Fix the BullMQ correctness bug where every job appeared stuck at `pending` forever on the dashboard, even after the worker terminal logged `✓ completed` / `✗ failed`.

  Two stacked architectural bugs are fixed in one change:

  1. `JobCollector` was monkey-patching `dispatch()` and mutating `job.handle` on the in-memory `Job` instance. BullMQ serializes the job via `JSON.parse(JSON.stringify(job))` and reconstructs a fresh instance in the worker process — so the wrapped handler that was supposed to flip status to `processing` / `completed` / `failed` lived only in the dispatcher's heap and was never reached.
  2. `MemoryStorage` is per-process. The dev/web process and the worker process held separate in-memory arrays with no path to share state; even if the wrap had survived, the dashboard process couldn't see what the worker recorded.

  **Fix shape:**

  - `@rudderjs/queue` now exposes a `@rudderjs/queue/observers` subpath — a `QueueObserverRegistry` singleton on `globalThis` that adapters emit lifecycle events to. Same pattern as `@rudderjs/mcp/observers`, `@rudderjs/http/observers`, etc.
  - The built-in `SyncAdapter` and `@rudderjs/queue-bullmq`'s `BullMQAdapter` emit `job.dispatched` / `job.active` / `job.completed` / `job.failed` events at the right lifecycle points. BullMQ emits `active` from the worker process via `processor()`, and `completed` / `failed` via `worker.on(...)` — the exact transitions that previously didn't reach the dashboard.
  - `@rudderjs/horizon` adds a third storage driver, `RedisStorage`, alongside `MemoryStorage` and `SqliteStorage`. The `JobCollector` is rewritten to subscribe to `queueObservers` instead of monkey-patching the adapter — observer events emitted in the worker process flow through Redis to the dashboard process.
  - `WorkerCollector` only self-registers when `RUDDERJS_QUEUE_WORKER=1` is set. The CLI sets it before booting providers when running `queue:work`, and the BullMQ adapter sets it again defensively before instantiating `Worker`s — so the dev/web process no longer lists itself as a worker.
  - `HorizonProvider.boot()` warns when `queue: bullmq` + `horizon.storage: memory` is detected, surfacing the misconfig before it manifests as a dead dashboard.

  **Migration:**

  If you're using `@rudderjs/queue-bullmq`, switch `config/horizon.ts` to:

  ```ts
  import { Env } from "@rudderjs/core";
  import type { HorizonConfig } from "@rudderjs/horizon";

  export default {
    storage: "redis",
    redis: {
      url: Env.get("REDIS_URL", ""),
      host: Env.get("REDIS_HOST", "127.0.0.1"),
      port: Env.getNumber("REDIS_PORT", 6379),
      password: Env.get("REDIS_PASSWORD", ""),
      prefix: "rudderjs",
    },
    // … rest of config unchanged
  } satisfies HorizonConfig;
  ```

  `ioredis` is now an optional dep — if you have `@rudderjs/queue-bullmq` installed, you already have it.

  If you're on the `sync` driver, no migration needed — `MemoryStorage` continues to work and `'memory'` stays the default.

  **Why a major bump:** the storage interface adds a third driver, the config interface adds `redis`, and the runtime path for BullMQ users changes meaningfully. The public `Horizon` facade (`recentJobs()` / `failedJobs()` / etc.) is unchanged.

  **`@rudderjs/queue`** — additive: new `@rudderjs/queue/observers` subpath. `SyncAdapter.dispatch()` now emits four lifecycle events. Existing consumers that don't subscribe see no behavior change.

  **`@rudderjs/queue-bullmq`** — emits the same lifecycle events from the dispatcher and worker processes. Sets `RUDDERJS_QUEUE_WORKER=1` before instantiating BullMQ `Worker`s.

  **`@rudderjs/cli`** — sets `RUDDERJS_QUEUE_WORKER=1` when argv includes `queue:work`, before booting providers, so cross-cutting collectors can self-register at the right time.

  Pulse's queue recorder has the same architecture as the old horizon JobCollector and currently misses BullMQ worker-side events too. Documented as a known limitation in pulse's README; fix deferred to a follow-up that subscribes the recorder to `queueObservers`.

  Plan: `docs/plans/2026-05-01-horizon-bullmq-fix.md`

## 4.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/core@1.0.0
  - @rudderjs/router@1.0.0

## 3.0.2

### Patch Changes

- 8411cd5: **Renamed `@rudderjs/rudder` → `@rudderjs/console`** to match Laravel's `Illuminate\Console` namespace and remove the "rudder rudder" stutter (the binary is `rudder`, the framework is RudderJS, and the authoring package is now `console` — no more triple-naming collision).

  **Migration for consumers:**

  ```ts
  // before
  import { Rudder, Command } from "@rudderjs/rudder";

  // after
  import { Rudder, Command } from "@rudderjs/console";
  ```

  **No symbol changes** — `Rudder`, `Command`, `CommandRegistry`, `CommandBuilder`, `MakeSpec`, `CancelledError`, `parseSignature`, `commandObservers` all keep their names. Only the import path changes.

  **No CLI changes** — the binary is still `rudder` (`pnpm rudder ...`), and the runner package is still `@rudderjs/cli`. Internal dependency updates only.

  **Naming model after this rename:**

  | Concept                 | Package                 | Surface               |
  | ----------------------- | ----------------------- | --------------------- |
  | Author HTTP routes      | `@rudderjs/router`      | `Route.get(...)`      |
  | Run HTTP routes         | `@rudderjs/server-hono` | (boots HTTP server)   |
  | Author console commands | `@rudderjs/console`     | `Rudder.command(...)` |
  | Run console commands    | `@rudderjs/cli`         | `rudder` binary       |

  The old `@rudderjs/rudder` will be deprecated on npm with a pointer to `@rudderjs/console` after publish.

- Updated dependencies [8411cd5]
  - @rudderjs/console@0.0.4
  - @rudderjs/core@0.1.4

## 3.0.1

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 3.0.0

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/router@0.3.0
  - @rudderjs/core@0.1.0

## 2.0.1

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1
  - @rudderjs/core@0.0.12

## 2.0.0

### Patch Changes

- Updated dependencies [6fb47b4]
  - @rudderjs/router@0.2.0
  - @rudderjs/core@0.0.11

## 1.0.0

### Patch Changes

- Updated dependencies [9fa37c7]
  - @rudderjs/router@0.1.0
  - @rudderjs/core@0.0.10

## 0.0.7

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/core@0.0.9
  - @rudderjs/router@0.0.4
  - @rudderjs/rudder@0.0.3

## 0.0.5

### Patch Changes

- Updated dependencies
  - @rudderjs/core@0.0.6

## 0.0.4

### Patch Changes

- Updated dependencies
  - @rudderjs/rudder@0.0.2
  - @rudderjs/core@0.0.5

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.4
