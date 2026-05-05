---
'@rudderjs/storage': minor
---

Storage v1 surface upgrades — pre-signed URLs, visibility, streams, file ops, and `Storage.fake()` (Laravel parity #4).

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
