# @rudderjs/socialite

## 2.0.1

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/core@1.1.5
  - @rudderjs/session@2.0.1

## 2.0.0

### Patch Changes

- @rudderjs/session@2.0.0

## 1.1.0

### Minor Changes

- 28bee3d: Fix Sign-in-with-Apple: the previous driver was non-functional in production and unsafe by design. Three findings closed (O2–O4 from the auth-surface review).

  - **O2 — Sign `client_secret` as an ES256 JWT per Apple's spec.** Apple rejects raw `client_secret` strings with `invalid_client`. The driver now mints a freshly-signed ES256 JWT (claims: `iss=teamId`, `sub=clientId`, `aud=https://appleid.apple.com`, `iat`/`exp`) just-in-time on each token exchange. New required config fields:
    - `teamId`: Apple Developer Team ID (10 chars)
    - `keyId`: Sign-in-with-Apple Key ID (the JWS `kid`)
    - `privateKey`: PEM contents of the `.p8` file from the Apple Developer portal
    - `clientSecretTtl?` (optional): JWT lifetime override in seconds; defaults to 5 minutes
      Signatures use IEEE P-1363 raw `r||s` encoding (64 bytes), as required by JWS — node:crypto's default DER encoding for EC keys won't work and is explicitly opted out of with `dsaEncoding: 'ieee-p1363'`.
  - **O3 — Verify `id_token` signature + claims.** The previous driver decoded Apple's id_token JWT payload via `Buffer.from(payload, 'base64url')` with no signature or claim verification — meaning a crafted id_token could supply any `sub`, becoming the app's primary user identifier (account-takeover risk). The driver now:
    - Fetches Apple's JWKS from `https://appleid.apple.com/auth/keys` and caches it for 1h (refetched on cache miss to handle key rotation).
    - Verifies the RS256 signature against the kid-matched public key.
    - Validates `iss === https://appleid.apple.com`, `aud` matches `clientId` (string or array form), `exp` is in the future, and `sub` is non-empty.
    - Rejects unexpected `alg` values (defends against `alg=none` confusion).
  - **Token exchange consolidated into one POST.** The previous driver POSTed the auth code twice — once via the inherited `getAccessToken`, then again in `getIdToken` — which Apple rejects because authorization codes are single-use. The override fetches `access_token` + `id_token` from the same response.
  - **O4 (related) — `getRedirectUrl` now inherits stateful CSRF state generation** introduced in O5 instead of skipping it. `response_mode=form_post` is preserved via a new `extraAuthParams()` hook on the base driver.

  **Breaking for any app currently configuring Apple via socialite (none on npm, since the driver was broken end-to-end):** `clientSecret` in `config('socialite.apple')` is no longer used. Add `teamId`, `keyId`, and `privateKey` to your Apple config.

  Exports `AppleSocialiteConfig` for typed Apple config in `config/socialite.ts`.

- 04b371e: Harden OAuth driver fetches against four review findings (O6–O9):

  - **O6 — Sanitize provider error messages.** Token exchange + user-info errors no longer interpolate the full response body into `Error.message`. Body is attached on `Error.cause` (`{ status, body }`) so callers that need it can still inspect, but log/error-tracking destinations stop receiving provider-echoed `client_id`, hints, or PII.
  - **O7 — Per-request timeout via `AbortSignal`.** All four built-in drivers (GitHub user-emails, Google/Facebook/GitHub token + user-info, Apple id_token) now fetch through a shared `fetchWithTimeout` helper on the base driver. Default 10s per request; override via `SocialiteDriverConfig.timeout` (milliseconds). Stops a hung provider endpoint from keeping a request handler alive indefinitely.
  - **O8 — Type-check the token-exchange response.** `access_token` must be a non-empty string (rejected if number / null / empty). `refresh_token` and `expires_in` fall back to `null` on type mismatch instead of being cast and exposed downstream.
  - **O9 — `Socialite.extend(name, factory)` invalidates the cached driver.** Previously, calling `extend()` after the driver had been resolved was silent: `_instances` kept the old instance. Now `extend()` drops the cached entry so the next `driver(name)` call uses the new factory. Helps hot-reload + runtime-override workflows.

  No breaking changes — `timeout` is additive, error semantics tighten only at the message-vs-cause split, and type-checking only rejects responses that would have produced runtime crashes downstream anyway.

- d2d3e2d: Add OAuth state generation/validation to `@rudderjs/socialite` (O5 — closes the login-CSRF / state-fixation gap across every provider).

  Previously, `getRedirectUrl(state?)` accepted an optional `state` but the framework neither generated nor validated it — `user(req)` ignored `query.state` entirely. Laravel Socialite (the inspiration) auto-generates and validates by default; this port had dropped that. Without state validation, an attacker can swap their authorization code into a victim's callback and link the victim's session to the attacker's social account.

  What changed:

  - **Stateful by default.** `redirect()` / `getRedirectUrl()` mints a 40-hex-char CSPRNG token, stores it on the session under `socialite_state:<provider>`, and embeds it in the OAuth URL. `user(req)` extracts the returned `state` from the query (or, for Apple's `form_post` callback, from the request body), compares with `crypto.timingSafeEqual` against the session-stored value, and throws `InvalidStateException` on mismatch / missing state / no session in context.
  - **One-time use.** Both successful and failed validation clear the session slot — a leaked or sniffed `state` cannot be replayed.
  - **Per-provider namespace.** `socialite_state:github`, `socialite_state:google`, etc. — concurrent OAuth flows on the same session don't collide.
  - **`.stateless()` opt-out.** For OAuth flows that can't reach the session (mobile, S2S token grants), `.stateless()` returns `this` and disables both generation and validation. Call-site equivalent of Laravel's `->stateless()`.
  - **`@rudderjs/session` is now a peer dep.** Stateful default needs the session in context. Apps using `@rudderjs/socialite` on the `web` group already have it (auto-installed by `SessionProvider`).

  `@rudderjs/session`: adds `_runWithSession(session, fn)` test-only helper so other packages can exercise code that goes through the `Session` static facade in unit tests without standing up the full middleware. Marked `@internal`; not part of the runtime contract.

  Migration notes:

  - Apps already on the `web` group with `@rudderjs/session` registered get the protection automatically — no code changes.
  - Apps that mount Socialite routes in the `api` group (no session) need to either opt into session-per-route or call `.stateless()` on each driver call. Stateless mode is appropriate for token-grant flows but **don't** use it on browser-initiated OAuth redirects without your own state implementation.
  - Existing callers passing `state` explicitly to `getRedirectUrl(state)` keep working — caller-supplied state always wins and skips the generator.

### Patch Changes

- c4c4a5d: Fix OAuth token endpoint encoding — `SocialiteDriver.getAccessToken()` now sends `application/x-www-form-urlencoded` per RFC 6749 §4.1.3 instead of `application/json`. GitHub, Google, and Facebook reject (or inconsistently accept) JSON bodies on `/token`, which made every non-Apple login fragile or fully broken depending on the provider's mood. Apple's driver already overrode this and is unchanged.

  No API change for callers — the public `getAccessToken(code)` signature and return shape are identical.

- Updated dependencies [b436a02]
- Updated dependencies [5bafd13]
- Updated dependencies [d2d3e2d]
  - @rudderjs/session@1.0.4

## 1.0.1

### Patch Changes

- dfba4df: Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.
- 4c8cd07: Fix fictional factory-function references in package READMEs — same drift class PR #233 fixed in `boost/guidelines.md`. Replaces non-existent `pkg(configs.pkg)` factory calls with the actual `*Provider` classes (e.g. `import { CacheProvider } from '@rudderjs/cache'` + `[CacheProvider]`), corrects auth's `authProvider(...)` → `AuthProvider` in setup + prose, fixes core's dynamic-registration example to use the real `CacheProvider` class, and updates ai's setup example to import `AiProvider` from the `/server` subpath. Documentation only; no code changes.
- Updated dependencies [4c8cd07]
  - @rudderjs/core@1.1.2

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
  - @rudderjs/core@1.0.0

## 0.0.7

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 0.0.6

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/core@0.1.0

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
  - @rudderjs/core@0.0.9
