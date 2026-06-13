# @rudderjs/http

## 1.3.0

### Minor Changes

- 4d5d4f3: fix(http): pool no longer abandons in-flight requests when one fails

  `Pool.send()` rejected the whole batch on the first failed request (`reject(err)` on the first task rejection). That had two problems: the other requests already in flight were abandoned — their work still ran to completion server-side but their results were discarded and could never be awaited — and a single connection error threw away every sibling's successful response.

  It now mirrors Laravel's `Http::pool()`: a failed request lands as an `Error` in its own slot, every other request runs to completion, and `send()` never rejects on a request failure. Concurrency limiting is unchanged.

  Return type widened from `HttpResponseData[]` to `(HttpResponseData | Error)[]` — narrow each slot before use:

  ```ts
  const results = await Http.pool((p) => {
    p.add((http) => http.get("/a"));
    p.add((http) => http.get("/b"));
  }).send();

  for (const r of results) {
    if (r instanceof Error) continue; // failed request
    console.log(r.status, r.body);
  }
  ```

  Previously a returned array was always all-success (any failure threw before returning), so existing runtime code that only read results after a successful batch keeps working; TypeScript callers now narrow the union.

### Patch Changes

- 4668c93: fix(http): make `asForm()` work and stop the per-request clone from dropping the body

  `asForm()` was effectively a no-op. Two bugs combined: `_clone()` (run by every verb method before sending) did not copy `_body` or `_bodyType`, so any encoding or body set on the builder was discarded; and `withBody()` — the path `post(url, data)` takes — unconditionally forced the encoding back to JSON, clobbering a prior `asForm()`. The documented `Http.withBody({...}).asForm().post('/login')` pattern actually sent an empty body, and `Http.asForm().post(url, data)` sent JSON.

  Now `_clone()` carries `_body`/`_bodyType` like every other field, and `withBody()` defaults the encoding to JSON only when none was chosen — so an explicit `asForm()` sticks regardless of call order. Form bodies are correctly serialized as `application/x-www-form-urlencoded`; JSON remains the default. Adds tests covering both `asForm()` paths, body survival across the clone, and JSON default (the body path had no test coverage before).

## 1.2.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

## 1.1.0

### Minor Changes

- ffbe0b9: Laravel-parity sequenced HTTP fakes — useful for testing retry, pagination, and back-off paths where each call should see a different response.

  - **`FakeManager.sequence(pattern?)`** returns a `Sequence` builder registered to the manager. `pattern` defaults to a wildcard regex (`/.*/`) — pass a string or `RegExp` to scope.
  - **`Sequence.push(response)`** appends a response to the queue.
  - **`Sequence.whenEmpty(fallback)`** sets the response returned for every call past the queue.
  - **`Sequence.isEmpty()` / `Sequence.remaining()`** — queue introspection.
  - **`Http.fakeSequence(pattern?)`** shortcut returning `[fake, sequence]` for the common one-fake-one-sequence pattern.

  Key difference from `register(pattern, [r1, r2])` (which silently repeats the last response forever): a `Sequence` **throws on exhaustion** unless `whenEmpty()` is set — so a hidden extra call surfaces in the test instead of getting a duplicate success response.

  Found by the Phase 3 testing-ergonomics audit (cluster 9).

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
- 704ae11: fix(storage,http,broadcast,log): Tier 4 quality sweep — S3 CopySource encoding, HTTP json() guard, WebSocket send guard, broadcast auth error surface, log cleanup error surface

## 1.0.0

### Major Changes

- 8ca33a1: Graduate to 1.0.0. The `Http` facade, fluent `PendingRequest` builder, `Pool` (concurrency-controlled batches), `FakeManager` (testing helpers), `http()` factory, and the `httpObservers` registry exposed at `@rudderjs/http/observers` are now part of the stable public API.

  Already dogfooded in the playground and consumed by `@rudderjs/telescope`'s HTTP collector via the observer contract. Future breaking changes will be flagged with major bumps and migration notes.

## 0.0.2

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages
