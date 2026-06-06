# @rudderjs/support

## 1.6.0

### Minor Changes

- 00e3b83: Typed `Env`: `Env.get('APP_NAME')` (and `getNumber`/`getBool`/`has`/`env()`) now autocompletes the keys your app declares. `@rudderjs/vite`'s new env scanner parses `.env.example` — the committed contract, never the secret `.env` — and emits `.rudder/types/env.d.ts` augmenting the new `EnvRegistry` interface in `@rudderjs/support`. Runs on dev/build, re-emits when `.env.example` changes, and the loose `string` overload stays for keys packages read that apps don't declare.

  New `rudder env:sync` command (skip-boot): regenerates the registry AND diffs `.env` against `.env.example` — missing keys are flagged, `--fix` appends them with their example values (or creates `.env` wholesale when absent). Keys only your `.env` carries are reported but never deleted.

## 1.5.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

## 1.4.2

### Patch Changes

- 14a50d9: Second round of CodeQL source hardening.

  - `@rudderjs/orm` (**security**) — `make:migration <name>` ran through `spawn(..., { shell: true })` (load-bearing on Windows, where the `pnpm` shim is `pnpm.cmd`), so a crafted name (`pnpm rudder make:migration "x; rm -rf ."`) was a shell-injection vector. The migration name — the only caller-influenced token in the command — is now validated against a strict identifier allowlist (`assertSafeName`) at both the Prisma and Drizzle sink sites; everything else in the command is a hardcoded literal.
  - `@rudderjs/ai` — the `web_fetch` tool's HTML→text extraction now removes `<script>`/`<style>` blocks with a tag-filter-safe regex (tolerates `</script >`) and strips remaining tags iteratively to a fixed point. Output is fed to the model as text, never rendered as HTML — this improves extraction robustness, not a security boundary. New `htmlToText` export.
  - `@rudderjs/mail` — extracted a shared `stripHtmlTags` helper (loop-to-stable tag removal) used by the Markdown text-alternative and the LogAdapter preview, replacing two single-pass strips.
  - `@rudderjs/support` — `ConfigRepository.set()` now guards prototype-polluting keys (`__proto__`/`constructor`/`prototype`) with a literal comparison directly at each assignment site instead of an upfront set-membership check; behavior is unchanged.

## 1.4.1

### Patch Changes

- 746caca: Harden two CodeQL-flagged patterns in shipped source:

  - `@rudderjs/support` — `Str.snake()` / `Str.headline()` previously detected the acronym→word boundary with `([A-Z]+)([A-Z][a-z])`, whose greedy `[A-Z]+` overlaps the following `[A-Z]` (a polynomial-ReDoS on long all-caps input). Rewritten to a fixed-width lookbehind `(?<=[A-Z])([A-Z][a-z])` — output is byte-identical for every case, no ambiguous quantifier.
  - `@rudderjs/mcp` — the OAuth2 `WWW-Authenticate` challenge escaped `"` in `error_description` but not `\`, so a description ending in a backslash could escape the closing quote and break out of the RFC 7235 quoted-string. Now escapes `\` before `"`.

## 1.4.0

### Minor Changes

- 3bf71b9: Add `reusableConnection(cacheKey, signature, build, dispose)` — reuse one long-lived connection (DB pool, Redis client, …) across Vite dev HMR re-boots instead of opening a fresh one on every edit. Caches the connection promise on `globalThis[cacheKey]` keyed by a caller-computed signature; an unchanged signature reuses the live connection, a changed one builds fresh and disposes the superseded one. Generalizes the inlined reuse in the orm adapters (#652) for connection-owning providers.

## 1.3.0

### Minor Changes

- feb0d02: Add `resolveIoredisClass<R>(mod)` — resolves the `Redis` constructor across the CJS/ESM interop variants `ioredis` ships. Pass the result of `import('ioredis')` (dynamic) or `import * as _ioredis from 'ioredis'` (static) and get back the class. Throws when no recognized shape matches — surfaces ioredis upgrade-shape changes loudly instead of silently constructing `undefined`.

  Shared by `@rudderjs/cache` (RedisAdapter) and `@rudderjs/broadcast-redis` (RedisDriver). Apps don't normally call this — it's a peer-resolver shim.

## 1.2.2

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

## 1.2.1

### Patch Changes

- fc79ae4: Fix `resolveOptionalPeer()` for ESM-only packages imported by subpath (e.g. `@rudderjs/ai/server`).

  When `createRequire().resolve()` rejected a subpath import because the package's exports field defined only an `import` condition (no `require` / `default`), the ESM-aware fallback then tried to `findPackageJson` using the full `<pkg>/<subpath>` string as the package name. That path never resolves to a real `package.json`, so the fallback also failed and the caller saw "Cannot find package … from <cwd>" — even though the package was correctly installed.

  The fallback now splits the specifier into a bare package name + a subpath, walks `node_modules` for the package, and resolves the requested subpath against its `exports` map. The visible symptom in apps scaffolded by `create-rudder-app` with `@rudderjs/ai` selected was a misleading `[RudderJS] @rudderjs/ai listed in the provider manifest but not installed` warning and a silently missing `AiProvider`.

## 1.2.0

### Minor Changes

- 95b588f: Fix `Str.plural` producing `pianoes` for loanwords ending in `-o` (removed overly-broad rule; `potato`/`tomato`/`echo`/`hero`/`veto` are covered by irregulars). Fix `Str.singular` producing `drif` for verb forms like `drives` (tightened `/ves$/` to require a consonant before `-ves`). Fix `Collection.splitIn(0)` division-by-zero producing wrong results (add guard matching `chunk()`). Add `Collection.sortBy()` and `Collection.unique()`. Add `Str`, `Num`, and `t()` sections to boost guidelines. Add tests for `t()`, `validateSerializable()`, new Collection methods, and pluralization edge cases.

### Patch Changes

- 95e9f4a: Include `boost/` directory in npm tarball so `guidelines://<pkg>` MCP resources are available in installed apps.

## 1.1.1

### Patch Changes

- 1d4f50b: fix(support): `Num.spell()` now handles trillions

  The implementation topped out at billions while the JSDoc claimed support up to `10^15 - 1`. `Num.spell(1_000_000_000_000)` now returns `'one trillion'` instead of the previous incorrect output.

  Also adds comprehensive test coverage for `Str` and `Num` (~40 tests covering `camel`/`snake`/`kebab`/`studly`/`title`/`headline`/`limit`/`words`/`excerpt`/`contains`/`startsWith`/`endsWith`/`before`/`after`/`between`/`replace*`/`pad*`/`squish`/`trim`/`mask`/`ascii`/`slug`/`uuid`/`isUuid`/`isUlid`/`random`/`password`/`plural`/`singular` and `format`/`currency`/`percentage`/`fileSize`/`abbreviate`/`ordinal`/`clamp`/`trim`/`spell`).

  Adds Collection coverage for previously-untested helpers: `flatMap`, `reject`, `first(predicate)`, `last(predicate)`, `contains(value)`, `isNotEmpty`, `sole`, `keyBy`, `mapWithKeys`, `chunk`, `splitIn`, `partition`, `sliding`, `zip`, `crossJoin`, `combine`, `mapSpread`, `when`, `unless`, `pipe`, `tap`.

## 1.1.0

### Minor Changes

- 62bbb8b: Add `isWebContainer()` runtime helper

  Returns `true` when the app is running inside a StackBlitz WebContainer
  (Node.js virtualized in the browser via WebAssembly). Useful for config
  defaults that need to flip drivers requiring raw TCP — Redis, SMTP,
  native Postgres — to in-memory, log, or cookie equivalents because
  WebContainers can't open raw TCP sockets.

  ```ts
  import { isWebContainer } from "@rudderjs/support";

  // config/cache.ts
  export default {
    default: isWebContainer() ? "memory" : "redis",
  };
  ```

## 1.0.0

### Major Changes

- cd38418: ## RudderJS 1.0 — wave 1

  Graduate 29 framework packages from `0.x` to `1.0.0`. The first batch of `@rudderjs/*` packages is now public-API stable — breaking changes will require explicit major bumps and migration notes from here on.

  **No code changes** — this is a version-line reset. Existing `0.x` consumers need to update their `@rudderjs/*` ranges from `^0.x.y` to `^1.0.0`. The scaffolder (`create-rudder-app`) is updated to emit `1.x` ranges.

  **Why now.** Under semver caret rules, `^0.X.Y` is exact-minor — every minor bump on a `0.x` peer goes out of range and triggers a cascading major bump on every dependent. Even with the `onlyUpdatePeerDependentsWhenOutOfRange` flag in place, the `0.x` baseline keeps producing spurious cascades. Telescope's v9 is mostly that. Once at `1.0`, `^1.0.0` absorbs all `1.x` minor/patch updates — cascades only fire for actual breaking changes.

  **Cascade noise will drop significantly:**

  - `^1.0.0` absorbs all 1.x minor/patch updates
  - Cascade now only fires for actual breaking changes (real majors)

  **Packages graduating to 1.0.0 in this wave:**

  `@rudderjs/contracts`, `core`, `support`, `log`, `hash`, `crypt`, `context`, `testing`, `middleware`, `cache`, `session`, `broadcast`, `schedule`, `mail`, `notification`, `storage`, `localization`, `pennant`, `socialite`, `queue-bullmq`, `queue-inngest`, `router`, `server-hono`, `view`, `orm`, `orm-prisma`, `passport`, `boost`, `ai`.

  `@rudderjs/ai` was originally on the defer list (recent runtime-agnostic split), but it peer-depends on `@rudderjs/core` — graduating core forces ai to graduate via cascade regardless. Listing it explicitly so the version line is intentional rather than a side-effect.

  **Packages NOT yet graduated (still 0.x), to graduate individually as they stabilize:**

  - _Too new / not yet exercised in the dogfood loop:_ `@rudderjs/concurrency`, `image`, `process`, `http`, `console`
  - _Recent significant changes:_ `@rudderjs/orm-drizzle`, `sync`, `vite`

  These will only patch-bump in this release (cascade via regular `dependencies`, not `peerDependencies`).

  **Already past 1.0 (untouched by this release):** `@rudderjs/auth`, `cli`, `mcp`, `queue`, `horizon`, `pulse`, `sanctum`, `telescope`, `cashier-paddle`. These keep their existing version lines; no reset.

  **Expected cascade:** dependents like `telescope`, `pulse`, `horizon`, `cli`, `auth`, `mcp`, `queue`, `sanctum` will major-bump in this release because their peer/dep ranges shifted from `^0.x` to `^1.0.0`. This is the _last_ spurious cascade — future releases of those packages will patch-bump on in-range peer updates.

## 0.0.4

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

## 0.0.3

### Patch Changes

- Quality pass: bug fixes, expanded tests, and docs improvements across core packages.

  - `@rudderjs/support`: fix `ConfigRepository.get()` returning fallback for falsy values (`0`, `false`, `''`); add prototype pollution protection to `set()`; fix `Collection.toJSON()` returning `T[]` not a string; fix `Env.getBool()` to be case-insensitive; fix `isObject()` to correctly return `false` for `Date`, `Map`, `RegExp`, etc.
  - `@rudderjs/contracts`: fix `MiddlewareHandler` return type (`void` → `unknown | Promise<unknown>`)
  - `@rudderjs/middleware`: add array constructor to `Pipeline` — `new Pipeline([...handlers])` now works
  - `create-rudder-app`: remove deprecated `.toHandler()` from `RateLimit` in scaffolded templates; remove nonexistent `.withExceptions()` call
