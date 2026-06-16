# @rudderjs/passport

## 2.0.5

### Patch Changes

- a48a97a: feat(core): polish the dev-boot notices block

  Refines the non-fatal boot-notices output rendered during `pnpm dev`:

  - The notices block now prints AFTER the `App is ready` line as a trailing footnote, instead of being wedged above it.
  - The block header uses a solid triangle (`▲`, yellow) instead of the `⚠` warning glyph, which renders narrow/ragged in many monospace fonts; each notice row now leads with a yellow `→` arrow to echo the Vike/Rudder banner lines above it.
  - `@rudderjs/ai`'s provider-skip notice is shorter and points at where the key is really set: `<name> skipped, no API key (set it in .env)`.
  - `@rudderjs/auth` and `@rudderjs/passport` notice messages drop the em-dash so the block reads consistently.

  Dev-output only. Production still prints `[RudderJS] ready` and flushes notices.

- Updated dependencies [a48a97a]
- Updated dependencies [ba9e629]
  - @rudderjs/core@1.13.1
  - @rudderjs/contracts@1.19.0

## 2.0.4

### Patch Changes

- a973ed1: Add an opt-in `config('passport').requireKeys` that fails the boot when no OAuth signing keypair is reachable (no `PASSPORT_PRIVATE_KEY`/`PASSPORT_PUBLIC_KEY` env vars and nothing on disk under `keyPath`). Previously a missing keypair only warned at boot and then 500'd every `/oauth/*` request with a generic ENOENT deep inside `Passport.keys()`. With `requireKeys: true`, a deployment that depends on OAuth fails fast (caught at deploy time) instead. The default stays warn-and-continue — passport is often installed without OAuth being actively used (it ships with the framework demo), and `APP_ENV` defaults to `production`, so keying the throw off production-detection alone would break apps that pull passport in transitively without configuring keys.

## 2.0.3

### Patch Changes

- 54c23ff: Bearer scope enforcement now reads the access token's scopes from the live DB row instead of the JWT claim. The DB row is the same mutable authority `revoked` lives on, so narrowing a token's scopes there (an operator action) takes effect on the next request, instead of being inert until the JWT naturally expires. For a normally-issued token the two are identical — `issueTokens` writes the same scopes to the row and the JWT — so this is a no-op for the common path and a correctness fix for the edit-then-expect-it-to-apply case.

## 2.0.2

### Patch Changes

- c7816ef: Make the device-flow polling rate-limit (RFC 8628 §3.5 `slow_down`) atomic. The interval check read `lastPolledAt` into a snapshot and then wrote it back in a separate statement, so two concurrent polls could both read a stale value and both slip past the gate, and a throttled poll's back-off clock didn't anchor to the last allowed poll. The check and the `lastPolledAt` advance are now a single conditional UPDATE: exactly one of N concurrent polls matches and proceeds, the rest are told to `slow_down`, and the window always measures from the last poll that was actually allowed. The first poll (no prior `lastPolledAt`) is still never throttled.
- 0bb5088: Security hardening of the OAuth 2 server (deep audit follow-up).

  - **PKCE is now enforced where codes are actually minted (`POST /oauth/authorize`), not just on the advisory `GET`.** Previously only the consent-render `GET` validated PKCE; the `POST` that issues the authorization code re-validated scopes (a prior fix) but not PKCE — so a public/native client could obtain a code with **no `code_challenge`**, or downgrade to `code_challenge_method=plain`, fully defeating PKCE. The grant-type and PKCE policy are now re-enforced on the issuance path (shared `enforceAuthCodePolicy`), and the `authorization_code` grant is also re-checked at the token exchange as defense-in-depth. **Behavior change:** a public client that was (incorrectly) skipping PKCE on the authorize POST must now send a valid S256 `code_challenge`, as the OAuth 2 BCP requires.
  - **Revoking an access token now also revokes its refresh token (RFC 7009 §2.1).** `DELETE /oauth/tokens/:id` previously flipped only the access token's `revoked` flag, leaving the paired refresh token live — so the holder of the refresh token could immediately mint a fresh pair and the revocation was moot. The endpoint now revokes the directly-paired refresh token and, when it belongs to a rotation family, the whole family (access + refresh).
  - **A `*` scope request no longer bypasses a client's per-client allow-list.** `validateScopes` exempted `*` from the per-client gate, so a client an operator explicitly restricted to e.g. `['read']` could request `scope=*` and receive an all-scope token — defeating the restriction. `*` is now constrained by a non-empty allow-list: a client is granted `*` only when its allow-list is empty (no restriction) or actually contains `*`. The global-registry exemption for `*` (it's a meta-scope, never a `tokensCan` entry) is unchanged.
  - **Family revocation failures are now reported, not silently swallowed.** `revokeFamily` (the anti-replay action on detected refresh-token reuse) caught and discarded all errors; a transient DB failure during an attack would silently no-op. It now `report()`s the error while staying best-effort.

## 2.0.1

### Patch Changes

- 74cc5cb: Validate requested scopes when issuing an authorization code. `POST /oauth/authorize` previously passed the attacker-controlled `scopes` from the request body straight into `issueAuthCode` with no validation — the `validateScopes` check ran only on the `GET` consent handler, whose result is echoed to the UI but never enforced. A client restricted to `['read']` (or constrained by the global scope registry) could therefore mint a code, and then a token, for any scope it asked for (e.g. `['write','admin']`) simply by POSTing them. The POST handler now re-validates the requested scopes against the global registry and the client's allow-list (reusing the client already resolved for the redirect_uri re-check), and coerces a non-array `scopes` body to `[]`.

## 2.0.0

### Major Changes

- 27eb426: Run the OAuth models on the native engine, and on both engines from one model set.

  The 5 models (`OAuthClient`, `AccessToken`, `RefreshToken`, `AuthCode`, `DeviceCode`) now carry the real SQL table names (`oauth_clients`, `oauth_access_tokens`, `oauth_refresh_tokens`, `oauth_auth_codes`, `oauth_device_codes`) in `static table` instead of the Prisma camelCase delegate names, and set `static keyType = 'ulid'` so the ORM stamps a primary key on insert. The native engine has no `@default(cuid())`, so without this the row id (which `AccessToken` uses as the JWT subject) would insert NULL — breaking token issuance on a native-engine deployment.

  **Breaking — Prisma apps must upgrade `@rudderjs/orm-prisma`** to a release with the SQL-table-name → delegate fallback. Without it, queries fail with `Prisma has no delegate for table "oauth_clients"`. With it, the SQL name resolves to the `oAuthClient` delegate via the client's runtime datamodel — no schema or data change needed.

  **Behavior change — new primary keys are ulid, not cuid.** Existing cuid rows are untouched (both are opaque strings in a `String @id` column); only rows created after upgrading get ulid ids. Access tokens / auth codes / device codes are short-lived, so the mix drains quickly. No migration required.

### Patch Changes

- Updated dependencies [e8bd81f]
- Updated dependencies [7c79edc]
- Updated dependencies [5c80378]
  - @rudderjs/core@1.11.0
  - @rudderjs/contracts@1.15.0

## 1.2.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

### Patch Changes

- Updated dependencies [e199f5e]
- Updated dependencies [0e7db2c]
- Updated dependencies [fc97c10]
- Updated dependencies [7e6dc85]
- Updated dependencies [0109afb]
- Updated dependencies [0dcecaf]
- Updated dependencies [363d942]
- Updated dependencies [12b4a55]
- Updated dependencies [4085846]
- Updated dependencies [6f8760d]
- Updated dependencies [083672b]
- Updated dependencies [8ba6e7d]
- Updated dependencies [b31d1be]
- Updated dependencies [0d6c280]
- Updated dependencies [3b995b7]
- Updated dependencies [5eb4dd8]
- Updated dependencies [536b64d]
- Updated dependencies [ea9b982]
- Updated dependencies [ad17e79]
- Updated dependencies [f6afdf8]
- Updated dependencies [e25472c]
- Updated dependencies [ca644ad]
- Updated dependencies [bf1cca0]
- Updated dependencies [bc76570]
- Updated dependencies [acc2245]
- Updated dependencies [0b085a6]
- Updated dependencies [468dcd4]
- Updated dependencies [ffbb7f7]
- Updated dependencies [b897950]
- Updated dependencies [caff11d]
- Updated dependencies [26b7acf]
- Updated dependencies [ea510e0]
- Updated dependencies [b08aa1d]
- Updated dependencies [6bd32b0]
- Updated dependencies [370d2ec]
- Updated dependencies [c66e195]
- Updated dependencies [473dfd9]
- Updated dependencies [6e83e26]
- Updated dependencies [5617ec2]
- Updated dependencies [bb07d54]
- Updated dependencies [7b5d000]
- Updated dependencies [f1db9d9]
- Updated dependencies [a93455e]
- Updated dependencies [e9a3319]
- Updated dependencies [534bd8d]
  - @rudderjs/contracts@1.10.0
  - @rudderjs/orm@1.14.0
  - @rudderjs/core@1.7.0

## 1.1.9

### Patch Changes

- 043ec24: fix: route the missing-keypair warning through the grouped boot-notice channel

  `PassportProvider.boot()` warned about a missing RSA keypair with an inline
  `console.warn`, so it printed mid-boot — between the banner and the provider
  tree — instead of in the grouped `⚠ N notices` block that every other provider
  notice (ai, auth) flushes after the tree. Switched it to `bootNotice('passport', …)`
  so the dev startup stays clean: banner → tree → notices → ready. No change to
  when the warning fires or what it says; it's just collected with the rest.

## 1.1.8

### Patch Changes

- eafdc7a: fix: close file check-then-write races (TOCTOU) in CLI scaffolders, the view/route scanners, and OAuth key generation

  Replaced `existsSync(path)` → later `write` patterns with a single atomic
  operation, so a concurrent process can't slip a file (or symlink) in between
  the check and the write:

  - **Scaffolders** (`make:*`, `make:module`, `rudder add`) now write with the
    exclusive `wx` flag and surface the same "already exists — use `--force`"
    message via an `EEXIST` catch. `--force` opts into truncation as before.
  - **`passport:keys`** writes the freshly generated keypair with `wx` (private
    key still `0o600`), so the write fails rather than following a pre-planted
    file/symlink at the key path. The non-`--force` guard now rejects when
    _either_ key already exists (previously only the private key), treating the
    pair atomically.
  - **`@rudderjs/vite` scanners** read-with-`ENOENT`-catch instead of
    `existsSync`-then-read for their idempotent codegen writes.

  No behavioral change for normal use; `--force` semantics are unchanged.

## 1.1.7

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [161c5c4]
  - @rudderjs/core@1.5.1
  - @rudderjs/orm@1.12.10

## 1.1.6

### Patch Changes

- cfcebed: `make:passport-client` was silently unreachable. The spec was registered inside `PassportProvider.boot()`, but the CLI deliberately skips `bootApp()` for `make:*` argv (the no-boot fast path) — so the spec was never wired into Commander, and `pnpm rudder make:passport-client <Name>` printed the top-level help (Commander treated it as an unknown command) instead of scaffolding the seeder. No error, no file, exit 0.

  Moved the spec to the documented CLI-loader subpath pattern used by every other package-contributed `make:*`: `@rudderjs/passport/commands/make-passport-client` exports `makePassportClientSpec` (same shape as `@rudderjs/terminal`'s `make-terminal`), and `@rudderjs/cli`'s `loadPackageCommands()` imports it eagerly. The in-boot registration block in `PassportProvider.boot()` is gone. End-to-end: `pnpm rudder make:passport-client <Name>` now creates `app/Seeders/<Name>.ts` as documented. Found by the Phase 1 scaffolder audit.

- Updated dependencies [27c0e0e]
- Updated dependencies [2af4fb6]
- Updated dependencies [18dc667]
  - @rudderjs/orm@1.12.9

## 1.1.5

### Patch Changes

- f4ebd5b: fix(passport): atomic claim on refresh-token + device-code grants

  Two paired OAuth grant races closed by mirroring the auth-code grant's atomic-update pattern. Both were RFC 6819 §5.2.2.3 violations — concurrent requests could each succeed at exchanging a single grant for token pairs.

  **Refresh-token grant** (`grants/refresh-token.ts`)

  Previously: read the row → check `revoked === false` → unconditionally flip `revoked = true` → issue tokens. Two concurrent refreshes both passed the read-time check, both flipped revoked (the second's flip was idempotent), and both minted new access+refresh pairs. The family-reuse detector at the top of the grant never fired because both saw revoked=false.

  Now: conditional `updateAll({ revoked: true })` with `.where('id', rt.id).where('revoked', false)` returns the affected row count. Exactly one of N concurrent calls sees count=1 and proceeds to issue. The rest see count=0, treat it as reuse, and revoke the rotation family.

  **Device-code polling** (`grants/device-code.ts`)

  Previously: read the row → check `approved === true` (in-memory snapshot) → issue tokens → delete row. Two concurrent polls of the same approved code both passed the in-memory check, both called `issueTokens`, both then deleted (idempotent). Result: one user approval minted two token pairs.

  Now: `.where('id', device.id).where('approved', true).deleteAll()` returns the affected row count. The winner proceeds; losers throw `invalid_grant` "Device code has already been used." — consistent with the auth-code grant's surface. The in-memory `device` snapshot is reused to issue tokens since the row is now gone from the DB.

  Regression tests: two new tests via `Promise.allSettled`, each runs two concurrent grants against the same opaque token / device code, asserts exactly one fulfilled + one rejected, exactly one new token pair minted (no double-issue).

- Updated dependencies [1553c9a]
- Updated dependencies [41f68b1]
- Updated dependencies [6652117]
- Updated dependencies [3e60f95]
  - @rudderjs/core@1.2.0
  - @rudderjs/orm@1.12.0
  - @rudderjs/contracts@1.8.0

## 1.1.4

### Patch Changes

- 765a19d: Route `Passport`'s configuration (scopes, lifetimes, RSA keys, custom models, authorization-view fn, route-ignored toggle, issuer, device-flow polling cap) through `globalThis` so the configuration survives the case where `@rudderjs/passport` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/passport` inline (grant handlers and bearer middleware read `Passport.*`) but `PassportProvider.boot()` and `Passport.tokensCan()` / `Passport.tokensExpireIn()` calls in `AppServiceProvider.boot()` can run from a `node_modules` copy resolved via the provider auto-discovery manifest. Without a shared store, scopes/lifetimes/RSA keys configured from the externalized copy would never be visible to grant handlers reading the bundled copy — every `/oauth/*` request would behave as if Passport was never configured.

  No public API change — every static setter/getter on `Passport` keeps its existing surface (`tokensCan`, `tokensExpireIn`, `setKeys`, `loadKeysFrom`, `useClientModel`, `authorizationView`, `ignoreRoutes`, `useIssuer`, `deviceMaxInterval`, `reset`, etc.). Defensive migration per the #499 static-state singleton audit. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500 (pennant), #501 (cache), #502 (queue), #503 (mail), #504 (storage), #505 (hash).

- Updated dependencies [16f87a4]
- Updated dependencies [4634586]
- Updated dependencies [bdfe575]
  - @rudderjs/orm@1.9.3

## 1.1.3

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/contracts@1.6.1
  - @rudderjs/core@1.1.5
  - @rudderjs/orm@1.9.2

## 1.1.2

### Patch Changes

- 552b105: refactor: document hidden contracts; collapse grant + bearer duplication; tighten 5 mixin casts

  - Extract `parseScopes()` (used by all 4 grants) and `verifyConfidentialCredentials()` (used by auth-code, client-credentials, refresh-token) into shared helpers under `grants/`. The four-step confidential-secret check (require-confidential, missing-secret, null-on-row, hash-mismatch) now lives in one place and can't drift across grants.
  - Refactor `bearer.ts`: extract `authenticateBearer()` returning a discriminated outcome (`authenticated` / `no-bearer` / `revoked` / `invalid`). `BearerMiddleware` and `RequireBearer` now share the verify-and-stamp path and only diverge on the failure handler. Eliminates ~75 lines of near-identical duplication and adds a typed `RawAuthBag` so the raw-request cast is no longer `Record<string, unknown>`.
  - Tighten 5 `(this as any)` casts in `personal-access-tokens.ts` to a narrow `HasApiTokensThis` interface (`id: string`, optional `__passport_token`).
  - Document four hidden contracts in `packages/passport/CLAUDE.md`: the `__rjs_user` / `__passport_token` raw-bag stamp pattern (and the subtlety that `req.user.tokenCan()` doesn't work because the plain copy drops mixin methods), the `id: string` assumption on `HasApiTokens`'s Base, the `parseJsonArray` fail-closed-with-warn behavior, and the single-authority status of `grants/verify-client.ts`.

  No public-API change.

- 624d410: Internal cleanup: split `src/routes.ts` (657 LOC) into a thin orchestrator + six cohesive siblings under `src/routes/`. The public subpath export `@rudderjs/passport/routes` is unchanged — `routes.ts` itself drops to 94 LOC and re-exports the same three public functions (`registerPassportRoutes`, `registerPassportWebRoutes`, `registerPassportApiRoutes`) plus the two public types. New layout:

  - `routes/types.ts` — `PassportRouteGroup`, `PassportRouteOptions`, internal `Router` + `RouteHandler`
  - `routes/helpers.ts` — `validateClientRedirect`, `resolveClientCredentials`, `resolveVerificationUri`, `authErrorResponse`, `asMiddlewareArray`, and a new `requesterIdFrom(req)` helper collapsing 3 repeated `(req.raw as any)?.__rjs_user?.id ?? (req as any).user?.id` reads
  - `routes/authorize.ts` — `GET/POST/DELETE /oauth/authorize`
  - `routes/token.ts` — `POST /oauth/token`
  - `routes/revoke.ts` — `DELETE /oauth/tokens/:id`
  - `routes/scopes.ts` — `GET /oauth/scopes`
  - `routes/device.ts` — `POST /oauth/device/code` + `POST /oauth/device/approve`

  Source casts: `as any` 6 → 0 inside routes (handled by the new `requesterIdFrom` helper); lint warnings 40 → 34. No public API or behavior change.

- 1b30a5c: Internal cleanup: drop the `as any` bridge casts on every `*Helpers` call site (grants + routes + personal-access-tokens) by broadening the `*Record` interfaces in `models/helpers.ts` to accept the Model-instance shape. JSON-encoded columns (`redirectUris`, `grantTypes`, `scopes`) are now typed as `unknown` because the runtime parser already handles both `string` (wire shape) and `string[]` (`@Cast('json')` hydrated shape). Token-record `scopes`/`createdAt` are marked optional to match the Models, which don't `declare` them as typed fields today. Source casts: 31 → 9 (net -22). No public API or behavior change — `helpers.ts` stays internal, the only exported surface unaffected.

## 1.1.1

### Patch Changes

- 95e9f4a: Include `boost/` directory in npm tarball so `guidelines://<pkg>` MCP resources are available in installed apps.
- Updated dependencies [f867181]
- Updated dependencies [0f69018]
- Updated dependencies [4d4991c]
  - @rudderjs/contracts@1.4.0
  - @rudderjs/core@1.1.3
  - @rudderjs/orm@1.8.1

## 1.1.0

### Minor Changes

- b4b37d3: Split Passport routes between web and api groups + opt-in CSRF — closes finding E7 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  `POST /oauth/authorize` is a state-changing endpoint reached from a logged-in browser session — the canonical CSRF target. The previous default (`registerPassportRoutes` on a single router) had no clean home for the consent flow when the app maintains separate web + api routers, and the playground mounted everything on the api group, where session/AuthMiddleware don't run, so the consent flow couldn't even resolve `req.user`.

  **Two new exports** carve out the right pairing:

  - `registerPassportWebRoutes(router, opts)` — mounts the consent flow (`GET/POST/DELETE /oauth/authorize`) and the revoke endpoint (`DELETE /oauth/tokens/:id`). Goes in `routes/web.ts`.
  - `registerPassportApiRoutes(router, opts)` — mounts `POST /oauth/token`, `POST /oauth/device/code`, `POST /oauth/device/approve`, and `GET /oauth/scopes`. Goes in `routes/api.ts`.

  Both are thin wrappers around `registerPassportRoutes(...)` with the appropriate `except` set, so they share every other option (`prefix`, `verificationUri`, `tokenMiddleware`, etc.). The original `registerPassportRoutes` keeps its everything-on-one-router behavior for back-compat.

  **`PassportRouteOptions.authorizeMiddleware`** — new opt-in slot for middleware to mount on the consent endpoints (parallel to the existing `tokenMiddleware`). Most apps should NOT use this option; the recommended pattern is to mount CSRF on the entire web group in `bootstrap/app.ts`:

  ```ts
  .withMiddleware((m) => m.web(CsrfMiddleware()))
  ```

  which automatically covers `/oauth/authorize` along with every other state-changing web route. `authorizeMiddleware` is the per-route fallback for apps that don't have group-level CSRF:

  ```ts
  import { CsrfMiddleware } from "@rudderjs/middleware";
  import { registerPassportWebRoutes } from "@rudderjs/passport";

  registerPassportWebRoutes(router, {
    authorizeMiddleware: [CsrfMiddleware()],
  });
  ```

  Don't do both — CsrfMiddleware running twice emits duplicate `Set-Cookie`s on GETs and runs validation twice on POSTs.

  Playground updated end-to-end: `routes/web.ts` mounts `registerPassportWebRoutes` (CSRF already covered by `m.web(CsrfMiddleware(...))` in `bootstrap/app.ts`); `routes/api.ts` switches to `registerPassportApiRoutes` and includes the recommended `tokenMiddleware` rate limiter.

  CLAUDE.md Architecture Rules + the file index updated to reflect the split and the don't-double-mount-CSRF guidance.

- 6b1485a: Configurable cap on device-flow `slow_down` interval escalation.

  The 60-second cap on `oauth_device_codes.interval` (added in #282) was hardcoded. RFC 8628 §3.5 doesn't specify a cap, so the value was a judgement call — fine for human-in-the-loop flows but constraining for niche cases (machine-only daemons, integration tests that want shorter ceilings, or apps that want to back misbehaving clients off more aggressively).

  The cap is now operator-tunable:

  ```ts
  // programmatic
  import { Passport } from "@rudderjs/passport";
  Passport.deviceMaxInterval(120); // bump to 2 minutes

  // via PassportConfig in config/passport.ts
  export default {
    // ...
    deviceMaxInterval: 120,
  } satisfies PassportConfig;
  ```

  **Default unchanged at 60 seconds.** Values below 5 are clamped to the 5s floor — the initial polling interval — because the escalation step is 5s and a cap below that would prevent any escalation from taking effect. Fractional values are floored.

  **New API:**

  - `Passport.deviceMaxInterval(seconds: number)` — setter, with floor + flooring as above.
  - `Passport.deviceMaxIntervalSeconds()` — getter.
  - `PassportConfig.deviceMaxInterval` — config-layer plumbing in `bootstrap/providers.ts` flow.

  `pollDeviceCode` now reads `Passport.deviceMaxIntervalSeconds()` instead of a module-level constant. The existing P9 regression test ("escalation caps at 60s") still passes — the default behavior is unchanged.

  **Tests:** eight new regression tests under "Passport.deviceMaxInterval — configurable cap on slow_down escalation" covering: default, setter override, floor clamp, fractional floor, reset semantics, escalation past 60s with raised cap, escalation halting at lowered cap, and the boot-integration setter/getter round-trip.

  CLAUDE.md "Device codes rate-limited" Architecture Rule updated to mention the configurability.

- 5d61ab5: Hash device codes at rest + escalate `slow_down` polling interval — closes findings P9 and M4 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`. Bundled because both touch the same `oauth_device_codes` table; one Prisma migration covers both.

  **M4 — at-rest hashing of `deviceCode` and `userCode`** (RFC 8628 §6.1).

  `oauth_device_codes` columns renamed: `userCode` → `userCodeHash`, `deviceCode` → `deviceCodeHash`. The plaintext is generated and returned once in the `/oauth/device/code` response body; only SHA-256 hashes are persisted. `pollDeviceCode` and `approveDeviceCode` hash their plaintext input before lookup, so a DB read leak no longer yields usable codes that an attacker could replay.

  New helper exported from `@rudderjs/passport`: `hashDeviceSecret(plaintext)`. Plain SHA-256 (no pepper) is sufficient because device codes are already unguessable per request — the threat is DB read leak, not pre-image attack on a chosen plaintext. See `device-code-secret.ts` for the longer-form rationale.

  Public API of `pollDeviceCode({ deviceCode })` and `approveDeviceCode(userCode, ...)` is unchanged — both still take **plaintext**, hash internally, and look up by hash. RFC 8628 wire format (`device_code` / `user_code` parameters) is unchanged.

  **P9 — `slow_down` polling interval escalates per RFC 8628 §3.5.**

  New `interval Int @default(5)` column on `oauth_device_codes` tracks the per-row polling interval. On each `slow_down` response, the server increments by 5 seconds (capped at 60). The new interval is forwarded in the `slow_down` error body so well-behaved clients can adopt it directly:

  ```json
  { "error": "slow_down", "interval": 10 }
  ```

  The `DevicePollResult` type's `slow_down` variant gains an `interval: number` field — additive on the discriminated union, so existing switch-discriminated callers stay shape-compatible.

  **Migration impact**

  The column rename is **destructive for in-flight device-code sessions** — the original plaintext is gone, and SHA-256 is one-way, so existing rows can't be migrated. The 15-minute TTL on device codes is the natural drain window: any device that requested a code before `prisma migrate deploy` runs sees `invalid_grant` on its next poll and re-issues a fresh code. Plan rollouts for a low-traffic window. One-time migration; not a recurring concern.

  CLAUDE.md Architecture Rules + Pitfalls updated. Findings doc covers the bundled migration in the "Recommended PR strategy" section.

- 4ccb117: `deviceMiddleware` option on `registerPassportRoutes()` — closes finding P8 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  RFC 8628 §5.2 calls for brute-force protection on the user_code surface. With a 32^8 ≈ 1.1×10^12 keyspace, the typical api-group rate limit (`m.api(RateLimit.perMinute(60))` in `bootstrap/app.ts`) already makes exhaustion infeasible — ~35,000 years of constant attack per IP — so most apps are already covered.

  For apps that want a tighter device-specific limit, Passport now surfaces `PassportRouteOptions.deviceMiddleware`, an opt-in slot for any middleware to mount on `POST /oauth/device/code` and `POST /oauth/device/approve` ahead of the handler. Pass a single handler or an array; the most common use is a tighter rate limiter:

  ```ts
  import { RateLimit } from "@rudderjs/middleware";
  import { registerPassportApiRoutes } from "@rudderjs/passport";

  registerPassportApiRoutes(router, {
    deviceMiddleware: [RateLimit.perMinute(5).by((req) => req.ip)],
  });
  ```

  Layered limits compose in sequence — group + per-route both run, with the tightest budget winning. The "lock individual user_codes after N misses" half of RFC 8628 §5.2's guidance isn't covered here (it's per-userCode state, not per-IP throttling); apps that need it can wrap their own middleware.

  `deviceMiddleware` is scoped to the device endpoints only; `/oauth/token`, `/oauth/authorize`, `/oauth/tokens/:id`, and `/oauth/scopes` are unaffected. Omitting the option is fully back-compat — the default registration is unchanged.

  CLAUDE.md "Pitfalls" updated with the recommended config.

- c2363b7: JWKS-style previous-key verifier — `passport:keys --force` no longer forces a global sign-out.

  **The problem (until now):** rotating the RSA keypair via `rudder passport:keys --force` invalidated every live access token instantly. Every JWT signed by the old private key failed signature verification under the new public key on the next request. Documented as a "forced sign-out window" pitfall — accepted, but never great.

  **The fix:** every new JWT carries a `kid` header equal to the SHA-256 fingerprint (base64url) of the public key that signed it (RFC 7515 §4.1.4). `verifyToken()` now walks `Passport.verificationKeys()` — a list `[currentPublicKey, ...optional previousPublicKeys]` — and accepts a match against any retained key. After a `passport:keys --force` rotation:

  - The new private key signs all new JWTs.
  - The previous public key is automatically retained at `storage/oauth-previous-public.key` (alongside the existing timestamped audit backups in `*.bak.<ISO-timestamp>`).
  - The verifier loads it on first use and keeps verifying tokens minted before the rotation, until they expire naturally (default 15 days for access tokens).
  - Operators drop the grace window by deleting `oauth-previous-public.key` or calling `Passport.setPreviousPublicKey(null)` — useful once the post-rotation tokens have all expired.

  **Legacy compat:** JWTs minted before this PR carry no `kid` header. The verifier falls through to "try each verification key in order" — same compat pattern as `iss` (P7) and the at-rest hashing migrations.

  **Single previous-slot by design.** One rotation deep. Operators who need a longer history should stage rotations to land outside the configured access-token lifetime — at that point the old tokens have already expired and a longer key history buys nothing.

  **New API surface:**

  - `Passport.setPreviousPublicKey(pem | null)` — operator-side override (e.g. for env-var-only deployments).
  - `Passport.previousPublicKey()` — getter.
  - `Passport.verificationKeys()` — async, returns `string[]` (current first).
  - `JwtHeader.kid` — typed in the public type.
  - `generateKeys()` returns a new `previousPublicPath: string | null` field on `GenerateKeysResult`. CLI prints it on rotation.

  **Tests:** 8 new regression tests under "JWKS-style previous-key verifier" — kid stamping, post-rotation success path, previous-slot cleared rejects, legacy no-kid trial-verify path, kid-but-key-gone rejection, reset semantics, and the verificationKeys ordering invariant.

  CLAUDE.md updated: the existing "Rotating the RSA keypair invalidates every live token" pitfall is now "carries a JWKS-style grace window" with the new operational instructions; Architecture Rules → Keys section mentions the `oauth-previous-public.key` convention.

- b839b89: Hash refresh tokens + auth codes at rest — closes findings M5 + P6 (second half) from `docs/plans/2026-05-06-passport-surface-review-fixes.md`. Last remaining schema-migration item from the passport-surface review.

  **The bug:** pre-migration, the plaintext bearer credential returned to the client WAS the row's cuid `id` on `oauth_refresh_tokens` and `oauth_auth_codes`. A DB read leak (`SELECT * FROM oauth_refresh_tokens` / `oauth_auth_codes`) handed every active refresh token and every in-flight auth code to the attacker as usable credentials.

  **The fix:** new `tokenHash String @unique` column on both tables. The plaintext returned to the client is now freshly generated `randomBytes(48).toString('base64url')` (384 bits CSPRNG, 64 chars URL-safe), decoupled from the row's `id`. Lookups hash the inbound plaintext before querying:

  ```ts
  // refreshTokenGrant
  const refreshTokenHash = await hashOpaqueToken(params.refreshToken);
  const refreshToken = await RefreshTokenCls.where(
    "tokenHash",
    refreshTokenHash
  ).first();

  // exchangeAuthCode
  const codeHash = await hashOpaqueToken(params.code);
  const authCode = await AuthCodeCls.where("tokenHash", codeHash).first();
  ```

  The atomic-consume update path (M3) and the family-revocation walk (P4) both key on the row's `id` once hydrated and are unaffected. The `accessTokenId` linkage is unchanged.

  Same plain-SHA-256 reasoning as `device-code-secret.ts`: the plaintext is high-entropy CSPRNG, so peppered HMAC buys nothing — the threat being mitigated is DB read leak.

  **Public exports:** `hashOpaqueToken`, `newOpaqueToken` from the package main entry. Mirrors `hashClientSecret` / `hashDeviceSecret`.

  **Prisma migration:**

  ```prisma
  model OAuthRefreshToken {
    // ...
    tokenHash     String   @unique
    // ...
  }

  model OAuthAuthCode {
    // ...
    tokenHash     String   @unique
    // ...
  }
  ```

  Both columns are `@unique` and indexed. Collision probability on SHA-256 of `randomBytes(48)` is negligible at any realistic scale.

  **Migration semantics — pre-existing credentials stop working at deploy time:**

  - **Refresh tokens** — affected sessions force-relogin on next refresh. Same blast radius as rotating the RSA keypair (a documented operator event). Plan as a coordinated sign-out window.
  - **Auth codes** — 10-minute TTL naturally drains. Affected redirect-back exchanges return `invalid_grant`; the user re-clicks "Authorize".

  This is a one-time migration. Once shipped, the contract is durable — token rotation is a normal operation, not a credential-invalidating event.

  **Tests:** six regression tests in `index.test.ts` (`oauth_refresh_tokens + oauth_auth_codes hashing (M5 + P6)`) covering: persisted hash vs. returned plaintext, lookup-by-hash on refresh, lookup-by-hash on exchange, presented-row-id-fails (the pre-fix bug), and atomic-consume regression on the new hashed lookup. Existing P4 reuse-chain tests updated to stamp `tokenHash` on test rows.

  CLAUDE.md "Architecture Rules" + "Pitfalls" expanded.

- 1f63c56: Added `scopeAny(...scopes)` middleware — OR-semantic counterpart to the
  existing `scope(...)` (AND). Use it when a route should accept any of a set
  of scopes rather than requiring every one. Closes the Laravel parity gap
  between `scope` and `scopes` middleware variants. Wildcard `*` still grants
  everything; calling `scopeAny()` with no scopes is a no-op safety net rather
  than an instant 403.
- d2458ad: `tokenMiddleware` option on `registerPassportRoutes()` — closes finding E8 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  `POST /oauth/token` is the canonical brute-force target for client_secret guessing — without a per-route rate limit, only the app's global limiter (if any) stands between an attacker and the entire client registry. Passport now surfaces `PassportRouteOptions.tokenMiddleware`, an opt-in slot for any middleware to mount on `/oauth/token` ahead of the handler. Pass a single handler or an array; the most common use is a rate limiter:

  ```ts
  import { RateLimit } from "@rudderjs/middleware";
  import { registerPassportRoutes } from "@rudderjs/passport";

  registerPassportRoutes(router, {
    tokenMiddleware: [
      RateLimit.perMinute(10).by((req) => `${req.ip}:${req.body?.client_id}`),
    ],
  });
  ```

  The composite key `${ip}:${client_id}` prevents one noisy client from exhausting the budget for legitimate co-tenants behind a shared NAT, AND prevents a single IP from churning through every client_id in the registry. `RateLimit` requires `@rudderjs/cache` to be registered — without a cache provider the middleware silently passes through.

  `tokenMiddleware` is scoped to the token endpoint only; other passport endpoints (`/oauth/authorize`, `/oauth/device/code`, `/oauth/device/approve`, `/oauth/tokens/:id`) are unaffected. Omitting the option is fully back-compat — the default registration is unchanged.

  CLAUDE.md "Pitfalls" updated with the recommended config.

- 4e006d9: `verifyToken` aud/iss validation + opt-in JWT issuer — closes finding P7 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  `verifyToken()` previously checked only the signature and expiration. RFC 8725 §3.10 / §3.12 recommend validating `aud` and `iss` whenever the deployment has more than one possible signer or audience — the latent risk this PR closes is cross-client token confusion or token replay across staging+prod sharing the same keypair. (BearerMiddleware's lookup-by-jti gives some protection in practice; this PR makes the protection explicit and forward-compatible.)

  **Two new knobs:**

  1. `Passport.useIssuer(url)` — opt-in. When set, `createToken()` stamps the URL as the `iss` claim on every new access token, and `BearerMiddleware`/`RequireBearer` ask `verifyToken()` to reject tokens whose `iss` doesn't match. Tokens minted before the issuer was configured carry no `iss` claim and stay verifiable during the migration window — same compat pattern as `redirect_uri` (P1) and `familyId` (P4). Single-issuer deployments don't need this.
  2. `verifyToken(jwt, options)` — `options.expectedAud` rejects audience mismatches; `options.expectedIssuer` rejects issuer mismatches (when the token carries an `iss` claim). Resource servers that gate to a specific client should pass `expectedAud`; `BearerMiddleware` doesn't pass it itself because it doesn't know the expected client until after the DB lookup.

  Wire-through: `PassportConfig` adds `issuer?: string`; `PassportProvider.boot()` calls `Passport.useIssuer()` when set. Reset() clears it. Empty string clears.

  ```ts
  // config/passport.ts
  export default {
    issuer: "https://app.example.com",
    // ...
  } satisfies PassportConfig;
  ```

  Rotation note added to CLAUDE.md Pitfalls: rotating the configured issuer URL invalidates every live token, same blast radius as rotating the RSA keypair. Plan as a forced sign-out window. Tokens minted before issuer was first configured (no `iss` claim) are NOT affected by rotation.

  New `VerifyTokenOptions` type exported alongside the existing `JwtPayload` / `JwtHeader`.

### Patch Changes

- 275c05d: Atomic single-use consumption of authorization codes (RFC 6749 §4.1.2).

  `exchangeAuthCode()` previously read the auth code, ran every check (PKCE, redirect_uri binding, client validation, expiry), and then issued an unconditional `update(id, { revoked: true })`. Two concurrent token-exchange requests with the same code each saw `revoked=false` on read, both passed every check, and both minted token pairs — violating the spec's single-use requirement.

  The revoke step is now a conditional update — `where('id', id).where('revoked', false).updateAll({ revoked: true })`. The underlying SQL `UPDATE ... WHERE revoked = false` is atomic in every supported backend, so exactly one concurrent caller sees `count === 1`; the loser sees `count === 0` and throws `invalid_grant` ("Authorization code has already been used.") before reaching `issueTokens()`.

  (Subsequent serial reuse of an already-consumed code keeps surfacing at the existing early-exit `if (authCode.revoked)` check — unchanged.)

  Closes finding M3 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

- 435a9ef: Support HTTP Basic client authentication at `/oauth/token` (RFC 6749 §2.3.1).

  The token endpoint now accepts client credentials via `Authorization: Basic base64(client_id:client_secret)` in addition to the existing body-param flow. Most off-the-shelf OAuth SDKs (Auth0, Okta, oauth2-proxy, etc.) default to Basic, so apps were forced to fork SDK config to opt into body-param mode. Per RFC §2.3.1 servers MUST support Basic; this fix closes the spec gap.

  **Conformance details (RFC 6749 §2.3):**

  - Basic prefix is matched case-insensitively (RFC 7235 §2.1).
  - Sending credentials in BOTH the header AND body is rejected with `invalid_request` — the spec forbids it. Both `client_secret` collision and a `client_id` mismatch are detected.
  - Malformed Basic (no colon, undecodable base64) returns `invalid_request`.
  - Missing `client_id` (no header, no body) now returns `invalid_request` 400 instead of producing the misleading "Client not found" via the database lookup.
  - The `client_credentials` grant now surfaces missing `client_secret` as `invalid_request` 401 (the grant is confidential-only by spec).

  Closes finding E9 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

- 6635e6e: `PassportProvider.boot()` now emits a clear startup warning when no RSA
  keypair is reachable — neither `PASSPORT_PRIVATE_KEY` / `PASSPORT_PUBLIC_KEY`
  env vars nor a keypair on disk under the configured key path. Previously
  the missing-keys footgun surfaced only on the first `/oauth/*` request as a
  generic ENOENT from deep inside `Passport.keys()`, which made the missing
  bootstrap step (`rudder passport:keys`) hard to trace. Also exposes
  `Passport.keysAvailable(): Promise<boolean>` for runtime probes.
- 03f4b5e: `purgeTokens` (and the `passport:purge` command) now issues a single bulk
  `deleteAll()` per model instead of reading every match into memory and looping
  per-row deletes. One round-trip per model, no hydration, no N+1.
- 99c5a7d: Docs: explain why access tokens are JWT-only with no DB hash column (matches
  Laravel Passport; signature is the secrecy boundary, not a stored hash) and
  add CLAUDE.md "Pitfalls" entries for the two surfaces reviewers most often
  miss — RSA keypair rotation invalidating every live JWT, and the device-flow
  verification URI defaulting to request `Host`/`X-Forwarded-Host` when
  `verificationUri` isn't configured.
- 1f002ea: `passport:client` CLI flag fixes — closes finding L2 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  **`--personal` is now a hint, not a client.** The previous behavior created an OAuth client with `grantTypes: ['personal_access']`, but `personal_access` is not an HTTP grant — `/oauth/token` rejects it, and personal access tokens go through `HasApiTokens.createToken()` against an internal `__personal_access__` client that the framework auto-manages. The CLI row was an orphan, present in the DB but unreachable through any flow. `passport:client --personal` now prints a short hint pointing at `HasApiTokens.createToken()` and exits without writing to the database. Pure CLI ergonomics — no migration needed.

  **`--device` clients now also carry `refresh_token`.** Device clients used to ship with only `urn:ietf:params:oauth:grant-type:device_code` in their grants array. Once the device flow exchanged a user_code for a token pair, the bundled refresh token was unusable: `/oauth/token` rejects refresh requests for clients whose grantTypes don't list `refresh_token`. RFC 8628 doesn't mandate a fixed list; pairing `refresh_token` with the device flow is the expected default for any device client that wants long-lived sessions on the polled device. New `--device` invocations get both grants.

  The grant-type → flag mapping is extracted to a new exported helper, `resolveClientGrantTypes({ isDevice, isM2M })`, so the CLI handler stays a thin wrapper and the mapping is unit-testable without booting the full provider.

- b0ccd35: Hash OAuth client secrets with an `APP_KEY`-derived HMAC pepper when set.

  `passport:client` (and `createClient()`) now stores confidential client
  secrets as `peppered:<HMAC-SHA256(secret, APP_KEY)>` when `APP_KEY` is
  configured, falling back to plain SHA-256 when it isn't. The `peppered:`
  prefix makes the format self-describing per row, so existing plain-SHA-256
  secrets keep verifying after the operator sets `APP_KEY` — no migration step.

  A leaked DB dump alone can no longer be brute-forced offline against
  candidate secrets without `APP_KEY`. New helpers `hashClientSecret()` and
  `verifyClientSecret()` are exported for apps that issue or verify client
  secrets outside the standard CLI/grant paths.

  Note: rotating `APP_KEY` invalidates every peppered client secret. Plan
  rotations as a coordinated re-issuance window — see
  `packages/passport/CLAUDE.md` "Pitfalls" for the full caveat.

- 5ac1136: Endpoint hardening — three RFC conformance fixes from the passport-surface review.

  **E5 — Bearer scheme is case-insensitive** (RFC 6750 §2.1 / RFC 7235 §2.1). `BearerMiddleware()` and `RequireBearer()` no longer reject `bearer xyz` or `BEARER xyz` — the prefix is matched against `authHeader.slice(0, 7).toLowerCase()`.

  **E10 — `invalid_client` returns HTTP 401 with `WWW-Authenticate`** (RFC 6749 §5.2). The auth-code grant was the inconsistent outlier — refresh-token and client-credentials already returned 401. All three `invalid_client` throws in `exchangeAuthCode()` now pass `401`, and the `/oauth/token` route appends `WWW-Authenticate: Basic realm="oauth"` whenever it surfaces a 401 OAuthError.

  **E11 — device-flow `slow_down` returns HTTP 400, not 429** (RFC 8628 §3.5). `slow_down` is a §5.2-shaped error and the spec doesn't authorise 429; the previous special case is removed.

  No schema, no API surface change. Closes findings E5, E10, E11 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

- d585476: Two security hardenings on the OAuth2 grant surface:

  - **PKCE: reject `code_challenge_method=plain` for public clients** (RFC 7636 §4.4.1 + OAuth 2.0 BCP). With `plain`, verifier == challenge, so a stolen authorization code is enough to mint tokens — defeating PKCE entirely. Confidential clients keep the `plain` option for backward compat. Closes finding P3 from the passport-surface review.
  - **Constant-time comparison on all 4 hashed-credential / verifier sites** (3 client-secret compares + 1 PKCE verifier compare). New `safeCompare()` helper uses `crypto.timingSafeEqual` after a length pre-check, replacing `!==` which short-circuits on first mismatch. Closes finding P5.

- 431eb0f: Mechanical cleanup bundle — closes findings L7, L8, P12, and E12 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  **L7 — drop `(x as any).id` casts.** `OAuthClient`, `AccessToken`, `RefreshToken`, `AuthCode`, and `DeviceCode` now `declare id: string`. Every call site that reached `.id` through an `(x as any).id as string` cast now hits the typed property directly (`token.id`, `client.id`, `authCode.id`, etc.) — same bytecode at runtime, the casts were purely a TypeScript ergonomics artifact. The seeder stub emitted by `make:passport-client` has been updated to match.

  **L8 — device-flow verification URI prefers `config('app.url')`.** `requestDeviceCode`'s default verification URI no longer derives from `${req.protocol}://${req.hostname}` first. Resolution order is now: `opts.verificationUri` → `config('app.url') + prefix + '/device'` → host-header fallback (kept for dev convenience). The fallback emits a one-shot warning so production deployments behind a reverse proxy without trust-proxy notice the host-header dependency. Most apps already export `app.url` in `config/app.ts` and won't see the warning.

  **P12 — single `Date.now()` snapshot in `issueTokens`.** `iat`, `exp`, `expires_in`, and the refresh token's `expiresAt` are all derived from one `const now = Date.now()` at the top of issuance. `createToken` accepts an optional `iatMs` so the caller's snapshot reaches the JWT payload — a downstream verifier no longer sees `iat + expires_in !== exp` from sub-second drift between independent `Date.now()` reads across the intervening async DB write + key load.

  **E12 — `state` echoed on auth-endpoint errors + `report()` for `server_error`.** `GET/POST/DELETE /oauth/authorize` now echo `state` back on every error path (RFC 6749 §4.1.2.1). Non-`OAuthError` throws across the OAuth handlers (`/authorize`, `/token`, `/device/code`, `/device/approve`) call `report()` so the root cause surfaces through the configured exception reporter instead of being silently collapsed under `server_error`.

- 8181057: Stop swallowing provider-boot errors under a misleading "rudder not available" catch.

  `PassportProvider.boot()` previously wrapped CLI command registration AND the `make:passport-client` scaffolder block in two nested catch-all `try/catch`es with the comment "rudder not available". `@rudderjs/core` is a hard dep of `@rudderjs/passport`, and `@rudderjs/console` is a hard dep of `@rudderjs/core`, so the dynamic imports always resolve — the catches couldn't possibly fire for the documented reason. What they DID swallow was every legitimate error from `rudder.command(...)` and `registerMakeSpecs(...)`: HMR-induced duplicate-registration bugs, future stub-validation errors, anything thrown inside an `await import('./commands/X.js')` lookup. All silently turned into a no-op boot.

  Both wrappers are gone. Errors now surface with their original stack instead of being lost. Closes finding L5 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

- 27dcb37: Personal-access surface cleanup — closes findings P10 and P11 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  **P10 — `user.tokens()` and `user.revokeAllTokens()` now scope to the personal-access client.** Previous behavior filtered only by `userId`, so a UI listing personal access tokens (or a "log out all my dev tokens" button) included OAuth-app session tokens issued by third-party clients on the user's behalf. Both methods now add a `clientId === personalAccessClient.id` predicate via the existing `getPersonalAccessClientId()` helper. JSDoc rewritten to describe the scoping explicitly.

  **P11 — `decodeToken` renamed to `unsafeDecodeToken`; old name kept as a deprecated alias.** The function decodes a JWT payload **without verifying the signature** — its output cannot be trusted for authentication decisions. The `unsafe` prefix forces a security pause when callers reach for it; the original `decodeToken` export remains as an alias (`export const decodeToken = unsafeDecodeToken`) so existing imports keep working. Boost guidelines updated to recommend the new name and document the constraint.

- 6349788: Token models are now `MassPrunable` — `pnpm rudder model:prune` reaps
  expired/revoked rows automatically.

  `AuthCode`, `DeviceCode`, `AccessToken`, and `RefreshToken` each define
  `static prunable()` and `static pruneMode = 'mass'`. The predicates mirror
  `passport:purge` exactly (`expiresAt < now OR revoked = true` for tokens,
  `expiresAt < now` for codes), so the two commands target the same rows and
  running them back-to-back is idempotent.

  `PassportProvider.boot()` eagerly registers the four classes with
  `ModelRegistry`, so the prune scheduler sees them on day-1 fresh apps —
  without this, the registry would only learn about the models lazily on
  the first oauth flow, silently skipping passport rows on a `model:prune`
  run from an inactive install.

- 23c217f: Bind `redirect_uri` to authorization codes and re-validate it on the consent endpoints (RFC 6749 §3.1.2.4 + §4.1.3). Closes findings P1, E3, and E4 from the passport-surface review.

  **What changed**

  - `OAuthAuthCode` gains a nullable `redirectUri` column. `issueAuthCode()` now persists the URI used at authorization, and `exchangeAuthCode()` requires the value submitted at the token endpoint to match exactly. Without this binding, an auth code obtained via one whitelisted redirect could be exchanged via any other registered redirect on the same client, breaking the OAuth threat model.
  - `POST /oauth/authorize` (consent approve) and `DELETE /oauth/authorize` (consent deny) now look up the client and re-validate `redirect_uri` against the client's whitelist before emitting the redirect URL. Previously both handlers blindly trusted the request body; the deny handler also fell back to a hard-coded `http://localhost` default, which is now removed in favour of an explicit `invalid_request` rejection.
  - New `redirectUri` field on `AuthCode` model + `AuthCodeRecord` helper interface.

  **Migration**

  Run a Prisma migration to add the new column to `oauth_auth_codes`:

  ```sql
  ALTER TABLE oauth_auth_codes ADD COLUMN redirectUri TEXT;
  ```

  Existing in-flight auth codes (≤10-minute lifetime) keep `redirectUri = null` and are exempt from the comparison so they remain exchangeable until they expire. All codes minted post-migration carry the binding.

- ac05bff: Detect refresh-token reuse and revoke the entire rotation family on detection (RFC 6819 §5.2.2.3 / OAuth 2.0 Security BCP §4.14). Closes finding P4 / M(H4) from the passport-surface review.

  **What changed**

  - `OAuthRefreshToken` gains a nullable `familyId` column (indexed). `issueTokens()` stamps a freshly generated UUID when no family is passed in, and `refreshTokenGrant()` propagates the existing id onto the rotated pair so a session's full chain shares one identifier.
  - When a previously-rotated refresh token is presented again, the grant now walks `WHERE familyId = X` and revokes every access + refresh token in that family before throwing `invalid_grant`. Previously the attacker who stole a refresh token before legitimate rotation could keep rotating forever while the victim was silently logged out.
  - New `familyId` field on `RefreshToken` model + `RefreshTokenRecord` helper interface; `issueTokens()` now accepts an optional `familyId` to support the rotation pass-through.

  **Migration**

  Run a Prisma migration to add the new column + index to `oauth_refresh_tokens`:

  ```sql
  ALTER TABLE oauth_refresh_tokens ADD COLUMN familyId TEXT;
  CREATE INDEX oauth_refresh_tokens_familyId_idx ON oauth_refresh_tokens(familyId);
  ```

  Existing refresh tokens (≤2-week lifetime by default) keep `familyId = null` and are exempt from the cascade so a legacy reuse still throws `invalid_grant` but does not affect unrelated rows. All tokens minted post-migration carry a family.

- 6df0968: Require bearer auth + ownership on `DELETE /oauth/tokens/:id`. Previously the revoke endpoint had no auth check at all, so any unauthenticated request could revoke any token by id — and token ids appear in JWT `jti` claims (semi-public), so anyone with a single captured JWT could DoS arbitrary users by revoking their tokens. Now: requires `RequireBearer()`, then checks `token.userId === requester.id`. Returns 404 (not 403) on ownership mismatch to avoid leaking whether a given id exists.
- 3672e21: Validate requested OAuth scopes against the global registry and per-client allow-list (RFC 6749 §3.3).

  Previously, `validateAuthorizationRequest`, `clientCredentialsGrant`, and `requestDeviceCode` accepted arbitrary scope strings — including scopes the operator never declared and scopes outside a client's configured allow-list. Tokens were minted with whatever the user approved, so `scope('admin')` middleware checks could be bypassed by a client requesting an undeclared `admin` scope.

  The three grants now run a shared `validateScopes(client, requested)` gate that throws `OAuthError('invalid_scope', ...)` when a requested scope is not registered globally via `Passport.tokensCan({...})` or is outside the client's `scopes` allow-list. Each gate is only enforced when populated:

  - Empty global registry → no global gate (back-compat with apps that haven't called `tokensCan`).
  - Empty `client.scopes` → no per-client gate (the common case — most clients are unrestricted).
  - The `*` wildcard always passes, matching `Passport.validScopes()` semantics.

  The refresh-token grant already has its own narrowing logic (request scopes can only be a subset of the original token's) and is unchanged.

  `validateScopes` is exported for apps that build their own grant pipeline.

  Closes finding E6 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

- 80888d2: Storage hygiene sweep — defense-in-depth on passport models.

  Closes M1, M6, M-L1, M-L2, M-L4, M-L5, M-L6 in
  `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  - **`revoked` removed from `fillable`** on `AccessToken`, `RefreshToken`, and
    `AuthCode`. Lifecycle flips happen through `instance.revoke()` (token
    models) or `QueryBuilder.where(...).updateAll({ revoked: true })` (grants);
    both bypass the mass-assignment filter. Defense-in-depth — a future
    caller-controlled `Model.create()` payload can no longer pre-mark a row as
    revoked.
  - **`revoke()` instance methods** on `AccessToken` and `RefreshToken` now
    `this.revoked = true; await this.save()` instead of the prior
    `(this as any).id`/static-update pattern.
  - **`AccessToken.userId` and `clientId` are `@Hidden`** so `toJSON()` strips
    them by default. Routes that surface `user.tokens()` no longer leak
    ownership mappings; admin views opt in via
    `instance.makeVisible(['userId', 'clientId'])`. `tokens()` JSDoc now
    documents the per-user scoping requirement.
  - **`OAuthClient` JSON columns** carry `@Cast('json')`. `redirectUris`,
    `grantTypes`, `scopes` hydrate as `string[]` automatically. Existing
    `JSON.stringify([...])` write callsites continue to work — `castSet('json')`
    returns string inputs verbatim.
  - **Confidential-client null-secret guard** added to `client_credentials`,
    `refresh_token`, and `authorization_code` grants. Catches a future refactor
    that could otherwise mask `client.secret = null` as authenticating against
    an empty string.
  - **`parseJsonArray`** in `models/helpers.ts` now logs a
    `[@rudderjs/passport]` warning (with truncated raw value + parse error)
    before returning `[]` on corrupt input. Behavior stays fail-closed;
    persistent corruption is no longer invisible.
  - **Stale `helpers.ts` comment** rewritten to reflect the post-PR-#111
    Model-instance reality.
  - **`personal-access-tokens.revokeAllTokens()`** collapsed from a
    read-then-N+1-update loop into a single bulk `QueryBuilder.updateAll`. Same
    result, one round-trip.

  No schema changes, no migrations.

- a8c20d7: Two passport-surface review fixes:

  - **`HasApiTokens.tokenCan(scope)` now actually works** (P2). The mixin previously read `__currentToken` — a field BearerMiddleware never wrote — so every gate check silently returned `false`. The mixin now reads `__passport_token` to match what the middleware writes on `req.raw`, and `BearerMiddleware` / `RequireBearer` stamp the same key onto the resolved user model before the plain-copy step so it propagates onto `req.user`. Closes finding P2 from the passport-surface review.
  - **`rudder passport:keys --force` no longer destroys old keys** (L1). Existing `oauth-private.key` / `oauth-public.key` are renamed to `*.bak.<ISO-timestamp>` before the new pair is written, and the CLI prints both backup paths plus a warning that JWTs signed by the old key now fail verification. `generateKeys()` returns the new `backup` field for programmatic callers. Closes finding L1.

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

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0
  - @rudderjs/orm@1.0.0

## 0.1.4

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
  - @rudderjs/core@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [f0b3bae]
- Updated dependencies [be10c83]
  - @rudderjs/core@0.1.2
  - @rudderjs/contracts@0.2.0
  - @rudderjs/orm@0.1.2

## 0.1.2

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/core@0.1.0
  - @rudderjs/orm@0.1.1

## 0.1.0

### Minor Changes

- 8ab284a: Passport Phase 6 — customization hooks.

  - `Passport.useClientModel()` / `useTokenModel()` / `useRefreshTokenModel()` / `useAuthCodeModel()` / `useDeviceCodeModel()` — swap in custom model classes (extend the base models to add columns or methods). Grants, routes, middleware, personal access tokens, and `passport:purge` all resolve models via the new `Passport.*Model()` getters.
  - `Passport.authorizationView(fn)` — render a custom consent screen from `GET /oauth/authorize`. The hook receives `{ client, scopes, redirectUri, state?, codeChallenge?, codeChallengeMethod?, request }` and may return a `view(...)` response or any router-acceptable value. JSON remains the default when unset.
  - `Passport.ignoreRoutes()` — short-circuits `registerPassportRoutes()` for manual wiring.
  - `registerPassportRoutes(router, { except: ['authorize'|'token'|'revoke'|'scopes'|'device'] })` — skip specific route groups.

  The `HasApiTokens` mixin type now accepts abstract base classes (such as `@rudderjs/orm`'s `Model`) and preserves the base's static methods, so `User extends HasApiTokens(Model)` composes cleanly.

### Patch Changes

- Updated dependencies [8b0400f]
  - @rudderjs/orm@0.1.0

## 0.0.5

### Patch Changes

- @rudderjs/core@0.0.12

## 0.0.4

### Patch Changes

- @rudderjs/core@0.0.11

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.10

## 0.0.2

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/contracts@0.0.4
  - @rudderjs/core@0.0.9
  - @rudderjs/orm@0.0.7
