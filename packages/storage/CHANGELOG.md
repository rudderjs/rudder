# @rudderjs/storage

## 1.2.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

### Patch Changes

- Updated dependencies [7e6dc85]
  - @rudderjs/core@1.7.0
  - @rudderjs/router@1.8.0

## 1.1.6

### Patch Changes

- 4b0c9d8: fix: contain LocalAdapter paths within the disk root (path traversal)

  `LocalAdapter` derived every filesystem path with `path.join(this.root, filePath)`
  and did nothing to stop `..` segments from escaping the configured disk root. An
  app that passed untrusted input — an upload filename, a user-supplied storage key
  — to `storage().put()/get()/delete()/copy()/move()/…` could read or write outside
  the disk (e.g. `put('../../etc/cron.d/x', …)`).

  `abs()` (and the visibility sidecar resolver) now route through a containment
  check that throws a new `StoragePathTraversalError` when the joined path climbs
  above the root, matching Laravel's behaviour of keeping every operation within
  the disk. The check runs before the defensive `try/catch` in `get`/`exists`/
  `delete`/`list`/`getVisibility`, so an escaping path fails loudly instead of
  being swallowed into a `null`/`false`/no-op. Paths that merely _use_ `..` but
  stay inside the root (`a/b/../c.txt`) still resolve normally, and an absolute
  path is neutralised (joined relative to the root, never honoured as-is) — which
  also closes the Windows drive/UNC-override variant.

  `StoragePathTraversalError` is exported from the package entry so callers can
  catch it. `FakeAdapter` (in-memory) and `S3Adapter` (object keys, not FS paths)
  are unaffected.

## 1.1.5

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [161c5c4]
  - @rudderjs/core@1.5.1
  - @rudderjs/router@1.7.1

## 1.1.4

### Patch Changes

- 3b56208: Route `StorageRegistry`'s adapters Map + default-disk state through `globalThis` so the registry survives the case where `@rudderjs/storage` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/storage` inline (`Storage.*` / `Storage.disk(...)` reads `StorageRegistry`), but `StorageProvider.boot()` runs from a `node_modules` copy of `@rudderjs/storage` resolved via the provider auto-discovery manifest. Without a shared store, `set()` from the externalized copy would land on a different class than the one `Storage.*` reads from inside the bundle, producing a misleading `Disk "<name>" not found` error on every storage call in prod.

  No public API change — same `set` / `setDefault` / `defaultName` / `get` / `reset` surface. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), PR #500 (`@rudderjs/pennant`), PR #501 (`@rudderjs/cache`), PR #502 (`@rudderjs/queue`), and PR #503 (`@rudderjs/mail`).

## 1.1.3

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/core@1.1.5
  - @rudderjs/router@1.2.1

## 1.1.2

### Patch Changes

- 704ae11: fix(storage,http,broadcast,log): Tier 4 quality sweep — S3 CopySource encoding, HTTP json() guard, WebSocket send guard, broadcast auth error surface, log cleanup error surface
- Updated dependencies [0f69018]
- Updated dependencies [b506997]
  - @rudderjs/core@1.1.3
  - @rudderjs/router@1.2.0

## 1.1.1

### Patch Changes

- 0496809: Two fixes on the temporary-URL + visibility surfaces from #216.

  - **`serveTemporaryUrls({ routePath: '/foo/:path*' })` no longer throws on registration.** The previous prefix-derivation did `replace(/\*+$/, '').replace(/:?path\*$/, '')` — the first regex consumed the trailing `*`, so the second one could no longer match `:path*`, the prefix kept its `:path` segment, the `endsWith('/')` guard tripped, and the function threw the "must end in `/*` or `/:path*`" error it was supposed to be checking against. Both documented forms now resolve to the same `/foo/` prefix.

  - **`LocalAdapter.move(from, to)` now moves the visibility sidecar alongside the file.** Visibility is stored in `<root>/.visibility/<path>` and `move()` only renamed the data file, so `getVisibility(to)` lost the source's visibility AND `put(from)` later inherited a stale value through the leaked sidecar. The sidecar now follows the file via the same `rename` → EXDEV-fallback `copyFile` + `unlink` ladder, with missing-sidecar (the common case — no prior `setVisibility`) silently no-oping.

  Tests added: two for `serveTemporaryUrls` (both routePath shapes resolve to the same prefix; non-splat path still rejected) and two for `move()` sidecar handling (carries to destination, leaves no leftover at source; missing-sidecar move is a no-op).

- Updated dependencies [158f7ee]
- Updated dependencies [7125676]
  - @rudderjs/core@1.1.1
  - @rudderjs/router@1.1.2

## 1.1.0

### Minor Changes

- cec0b33: Storage v1 surface upgrades — pre-signed URLs, visibility, streams, file ops, and `Storage.fake()` (Laravel parity #4).

  **Pre-signed URLs:**

  - `Storage.disk('s3').temporaryUrl(filePath, expiresAt, opts?)` — returns a short-lived signed download URL via `@aws-sdk/s3-request-presigner`. `opts` accepts `responseContentDisposition` / `responseContentType`.
  - `Storage.disk('s3').temporaryUploadUrl(filePath, expiresAt)` — returns `{ url, headers }` for direct browser-to-S3 PUT uploads.
  - `Storage.disk('local').temporaryUrl(...)` works once you call `serveTemporaryUrls(router, { disk, routePath: '/storage/temp/*' })` from your bootstrap — issues HMAC-signed URLs that point at a controller route the helper registers. Validates via `Url.isValidSignature()` and streams the file from disk.
  - `LocalAdapter.temporaryUploadUrl()` throws `StorageNotSupportedError` (use a normal POST endpoint with multipart middleware in dev).
  - Both methods reject when `expiresAt <= Date.now()`.

  **Visibility:**

  - `setVisibility(filePath, 'public' | 'private')` / `getVisibility(filePath)` on every adapter.
  - S3 maps to `PutObjectAclCommand` / `GetObjectAclCommand` (`public-read` ↔ `private`; `getVisibility` parses the `Grants` array for `AllUsers READ`).
  - Local writes mode bits (`0o644` / `0o600`) plus a `<root>/.visibility/<path>` sidecar so Windows / FUSE volumes still report correctly. `delete()` removes the sidecar too.

  **Streams:**

  - `readStream(filePath): Promise<Readable>` and `writeStream(filePath, stream): Promise<void>` on every adapter.
  - S3 returns the SDK's `GetObjectCommand` `Body` directly; uploads use `@aws-sdk/lib-storage`'s `Upload` (multipart).
  - Local uses `node:fs` `createReadStream` / `createWriteStream` with `pipeline()` for back-pressure.

  **File ops:**

  - `copy(from, to)`, `move(from, to)`, `append(filePath, contents)`, `prepend(filePath, contents)` on every adapter.
  - `BaseAdapter` ships defaults (`move = copy + delete`, `append/prepend = read + concat + put`, `text = get + utf8`); adapters override only what has a faster path.
  - Local `move` falls through `EXDEV` to `copyFile + unlink` for cross-device renames.
  - S3 `copy` issues `CopyObjectCommand`.

  **Testing:**

  - `Storage.fake(name?)` swaps a disk for a `FakeAdapter` (in-memory) and returns it for fluent assertions: `assertExists`, `assertMissing`, `assertCount(dir, n)`, `assertDirectoryEmpty(dir)`. Idempotent — calling again resets the in-memory store. `Storage.restoreFakes()` reverses every swap (call in `afterEach`). Both also re-bind the DI container key (`storage.<name>`).

  **New optional dependencies:** `@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-storage` (alongside the existing `@aws-sdk/client-s3`). `@rudderjs/router` is now an optional peer dependency — required only if you call `serveTemporaryUrls()` from a `LocalAdapter` setup.

  **Refactor:** adapters split into `src/adapters/{local,s3,fake}.ts` with a shared `BaseAdapter` (`src/base.ts`). `StorageRegistry` moved to `src/registry.ts`. New `StorageNotSupportedError` for adapters that legitimately can't do something. All public exports stay on `@rudderjs/storage` — no consumer migration needed.

### Patch Changes

- Updated dependencies [6c03c74]
- Updated dependencies [3ccac5d]
- Updated dependencies [5447fa9]
- Updated dependencies [a0b96f9]
- Updated dependencies [ca63e78]
- Updated dependencies [fcca26b]
  - @rudderjs/core@1.1.0
  - @rudderjs/router@1.1.0

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

## 0.0.12

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 0.0.11

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/core@0.1.0

## 0.0.10

### Patch Changes

- dc37411: Ship `boost/guidelines.md` in the published npm tarball. Adds `"boost"` to the `files` field so downstream `boost:install` in consumer projects finds the per-package AI coding guidelines.
  - @rudderjs/core@0.0.12

## 0.0.9

### Patch Changes

- @rudderjs/core@0.0.11

## 0.0.8

### Patch Changes

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

## 0.0.5

### Patch Changes

- Updated dependencies
  - @rudderjs/core@0.0.6

## 0.0.4

### Patch Changes

- @rudderjs/core@0.0.5

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.4
