# `@rudderjs/storage` — temporaryUrl + visibility + streams + copy/move + Storage.fake

**Status:** PROPOSED — design + implementation contract.
**Author handoff:** filed for the next rudder agent. Self-contained.
**Scope:** v1 = pre-signed URLs (S3 + Local-via-signed-route), visibility get/set, streams, file ops (copy/move/append/prepend), and `Storage.fake()` with assertion helpers.
**Out of scope (deferred):** SFTP / FTP drivers, scoped disks (`Storage.disk(...).path-prefix(...)`), per-disk middleware, S3 multipart uploads.

---

## Why this is the right next bite

Today's `@rudderjs/storage` ships `put / get / text / delete / exists / list / url / path` plus `Local` and `S3` adapters. The gaps below are the ones every upload-touching feature hits immediately:

| Gap | Why it bites |
|---|---|
| `temporaryUrl` | Avatars / private downloads want short-lived signed URLs; today users hand-write the S3 presigner and bypass the facade. |
| `temporaryUploadUrl` | Direct-to-S3 browser uploads ("don't proxy 50 MB through Node") are impossible through the facade. |
| Visibility | Every S3 bucket-policy question collapses to "public-read or private?" — the facade has no answer. |
| Streams | `Storage.get()` returns a `Buffer`. A 200 MB upload OOMs the server. |
| `copy / move / append / prepend` | Trivial, but every consumer rewrites them. |
| `Storage.fake()` | Tests touch real disks today. Laravel's `Storage::fake()` is the single biggest UX win after the facade itself. |

All six share the same shape: **widen the adapter contract → S3 leans on the AWS SDK → Local has a sensible non-cloud equivalent → Fake implements everything in memory**.

---

## Public API (final shapes)

### Pre-signed URLs

```ts
interface TemporaryUrlOptions {
  /** Override Content-Disposition on the response (download with filename). */
  responseContentDisposition?: string
  /** Override Content-Type. */
  responseContentType?: string
  /** Custom request headers (S3: signed query params). */
  responseHeaders?: Record<string, string>
}

await Storage.disk('s3').temporaryUrl(
  'invoices/2026-05.pdf',
  new Date(Date.now() + 60_000),                  // expiresAt
  { responseContentDisposition: 'attachment; filename="may.pdf"' },
)
// → 'https://bucket.s3.us-east-1.amazonaws.com/invoices/2026-05.pdf?...&X-Amz-Signature=...'

await Storage.disk('s3').temporaryUploadUrl(
  'uploads/u-42/avatar.jpg',
  new Date(Date.now() + 300_000),
)
// → { url: 'https://bucket.s3...&X-Amz-Signature=...', headers: { 'x-amz-acl': 'private' } }
```

Note: `temporaryUploadUrl` returns `{ url, headers }`, not just a string — the browser must include any signed headers on the PUT.

### Visibility

```ts
type Visibility = 'public' | 'private'

await Storage.disk('s3').setVisibility('avatars/u-1.jpg', 'public')
const v = await Storage.disk('s3').getVisibility('avatars/u-1.jpg')   // 'public' | 'private'
```

### Streams

```ts
import type { Readable } from 'node:stream'

const stream: Readable = await Storage.disk('s3').readStream('big.zip')
stream.pipe(res)                                                       // 200 MB safe

await Storage.disk('local').writeStream('uploads/u.zip', uploadStream) // resolves on 'finish'
```

`readStream` returns `Readable`. `writeStream` accepts a `Readable` (or anything `pipe`-able) and resolves once the destination has flushed.

### File ops

```ts
await Storage.copy('avatars/u-1.jpg', 'avatars/backup/u-1.jpg')
await Storage.move('tmp/upload.jpg', 'avatars/u-1.jpg')                // rename / S3 copy+delete
await Storage.append('logs/app.log', 'request 42 OK\n')
await Storage.prepend('changelog.md', '# 1.2.0\n')
```

`copy / move` work cross-disk in v2 if both adapters are present in the registry — v1 is single-disk only (an explicit error if you try). All four are part of the `StorageAdapter` contract; `append/prepend` have a default in a new `BaseAdapter` mixin (read → concat → write).

### `Storage.fake()`

```ts
import { Storage } from '@rudderjs/storage'

const disk = Storage.fake()             // replaces 'default' disk in registry
const s3   = Storage.fake('s3')         // replaces named disk

await Storage.put('a.txt', 'hello')
disk.assertExists('a.txt')
disk.assertMissing('b.txt')
disk.assertCount('logs/', 0)
disk.assertDirectoryEmpty('logs/')

Storage.restoreFakes()                  // reset to original adapters (call in afterEach)
```

`Storage.fake(name?)` returns a `FakeAdapter` instance so you can call assertions fluently. The original adapter is stashed in a private `_originalDisks` map and restored by `Storage.restoreFakes()`. Idempotent — calling `fake()` twice keeps the same `FakeAdapter` and resets its in-memory store.

---

## Adapter contract additions

`packages/storage/src/index.ts` — extend `StorageAdapter`:

```ts
export interface StorageAdapter {
  // ─── existing ───
  put(filePath: string, contents: Buffer | string): Promise<void>
  get(filePath: string): Promise<Buffer | null>
  text(filePath: string): Promise<string | null>
  delete(filePath: string): Promise<void>
  exists(filePath: string): Promise<boolean>
  list(directory?: string): Promise<string[]>
  url(filePath: string): string
  path(filePath: string): string

  // ─── new (v1) ───
  temporaryUrl(filePath: string, expiresAt: Date, opts?: TemporaryUrlOptions): Promise<string>
  temporaryUploadUrl(filePath: string, expiresAt: Date): Promise<{ url: string; headers: Record<string, string> }>

  setVisibility(filePath: string, visibility: Visibility): Promise<void>
  getVisibility(filePath: string): Promise<Visibility>

  readStream(filePath: string): Promise<Readable>
  writeStream(filePath: string, stream: Readable): Promise<void>

  copy(from: string, to: string): Promise<void>
  move(from: string, to: string): Promise<void>
  append(filePath: string, contents: string | Buffer): Promise<void>
  prepend(filePath: string, contents: string | Buffer): Promise<void>
}
```

**Default implementations** live on a new `BaseAdapter` abstract class:

- `append / prepend` — read → concat → put.
- `move` — copy then delete.
- All adapters extend `BaseAdapter` and override what they have a faster path for.

**Adapters that genuinely can't do something** throw a typed error:

```ts
export class StorageNotSupportedError extends Error {
  constructor(driver: string, op: string) {
    super(`[RudderJS Storage] ${driver} adapter does not support "${op}". See docs/storage.md for alternatives.`)
    this.name = 'StorageNotSupportedError'
  }
}
```

E.g., `LocalAdapter.temporaryUploadUrl` throws by default unless `serveTemporaryUrls()` (see below) is registered.

---

## Implementation per adapter

### `S3Adapter` — pre-signed URLs

Use the official `@aws-sdk/s3-request-presigner` package. **Add to `optionalDependencies`** alongside `@aws-sdk/client-s3`.

```ts
// packages/storage/src/adapters/s3.ts
async temporaryUrl(filePath: string, expiresAt: Date, opts?: TemporaryUrlOptions): Promise<string> {
  const client = await this.getClient()
  const { GetObjectCommand } = this.cmds()
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner') as typeof import('@aws-sdk/s3-request-presigner')

  const cmd = new GetObjectCommand({
    Bucket: this.bucket,
    Key:    filePath,
    ...(opts?.responseContentDisposition && { ResponseContentDisposition: opts.responseContentDisposition }),
    ...(opts?.responseContentType        && { ResponseContentType:        opts.responseContentType }),
  })
  const expiresIn = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  return getSignedUrl(client as never, cmd as never, { expiresIn })
}

async temporaryUploadUrl(filePath: string, expiresAt: Date): Promise<{ url: string; headers: Record<string, string> }> {
  const client = await this.getClient()
  const { PutObjectCommand } = this.cmds()
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner') as typeof import('@aws-sdk/s3-request-presigner')

  const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: filePath })
  const expiresIn = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  const url = await getSignedUrl(client as never, cmd as never, { expiresIn })
  return { url, headers: {} }
}
```

`getSignedUrl(client, command, opts)` is the canonical AWS SDK v3 presign API. It works for any `*Command` — `GetObjectCommand` for download, `PutObjectCommand` for upload, `DeleteObjectCommand` for `deleteUrl()` (not in v1 scope).

The `as never` casts dodge the SDK's deep `Client<...>` generic mismatch between our `unknown` client and the presigner's expected client shape — same dynamic-import escape hatch already used in `getClient()`.

### `S3Adapter` — visibility

S3 stores visibility as ACL. `setVisibility` writes `acl: 'public-read'` or `acl: 'private'` via `PutObjectAclCommand`. `getVisibility` reads `GetObjectAclCommand` and inspects the `Grants` array — `public` if any `Grantee.URI === 'http://acs.amazonaws.com/groups/global/AllUsers'` with `Permission === 'READ'`, else `private`. Add the two commands to the `S3Commands` type and the dynamic-import block.

```ts
async setVisibility(filePath: string, visibility: Visibility): Promise<void> {
  const client = await this.getClient()
  await client.send(new (this.cmds().PutObjectAclCommand)({
    Bucket: this.bucket, Key: filePath,
    ACL: visibility === 'public' ? 'public-read' : 'private',
  }))
}
```

### `S3Adapter` — streams

`GetObjectCommand`'s `Body` is already a Node `Readable` (`IncomingMessage`-like) on Node. `readStream` returns it directly. `writeStream` uses `@aws-sdk/lib-storage`'s `Upload` helper (handles multipart automatically). **Add `@aws-sdk/lib-storage` to `optionalDependencies`**.

```ts
async readStream(filePath: string): Promise<Readable> {
  const client = await this.getClient()
  const res = await client.send(new (this.cmds().GetObjectCommand)({
    Bucket: this.bucket, Key: filePath,
  })) as { Body?: Readable }
  if (!res.Body) throw new Error(`[RudderJS Storage] readStream: ${filePath} not found.`)
  return res.Body
}

async writeStream(filePath: string, stream: Readable): Promise<void> {
  const client = await this.getClient()
  const { Upload } = await import('@aws-sdk/lib-storage') as typeof import('@aws-sdk/lib-storage')
  await new Upload({ client: client as never, params: { Bucket: this.bucket, Key: filePath, Body: stream } }).done()
}
```

### `S3Adapter` — copy/move

```ts
async copy(from: string, to: string): Promise<void> {
  const client = await this.getClient()
  await client.send(new (this.cmds().CopyObjectCommand)({
    Bucket: this.bucket, Key: to,
    CopySource: `${this.bucket}/${encodeURIComponent(from)}`,
  }))
}
// move = copy then delete (BaseAdapter default is fine).
```

Add `CopyObjectCommand` to the `S3Commands` import block.

### `LocalAdapter` — pre-signed URLs (signed route fallback)

S3 owns the bucket; Local has no bucket. Solution: **issue a signed URL pointing at a controller route the app registers** (via `serveTemporaryUrls(...)`).

```ts
// app side, in routes/web.ts
import { serveTemporaryUrls } from '@rudderjs/storage'
import { router } from '@rudderjs/router'

serveTemporaryUrls(router, {
  disk: 'local',                    // disk to serve
  routePath: '/storage/temp/:path*' // controller route (must contain :path*)
})
```

`serveTemporaryUrls(router, opts)` registers a `GET` route on the router that:

1. Validates the signature via `Url.isValidSignature(req)` (already in `@rudderjs/router`).
2. Streams the file from `Storage.disk(opts.disk).readStream(req.params['path'])`.
3. Returns `404` if missing.

`LocalAdapter.temporaryUrl(...)` then calls `Url.sign(...)` from `@rudderjs/router` to produce the URL. **`@rudderjs/storage` declares `@rudderjs/router` as an optional peer** and uses `resolveOptionalPeer('@rudderjs/router')` (same shape as `@rudderjs/core`'s router resolution — see `CLAUDE.md` "Cycle resolution" note).

```ts
// packages/storage/src/adapters/local.ts
async temporaryUrl(filePath: string, expiresAt: Date, _opts?: TemporaryUrlOptions): Promise<string> {
  const { Url } = await resolveOptionalPeer<typeof import('@rudderjs/router')>('@rudderjs/router') ?? {}
  if (!Url) {
    throw new StorageNotSupportedError('local', 'temporaryUrl')
  }
  if (!this._tempUrlConfig) {
    throw new Error(
      '[RudderJS Storage] LocalAdapter.temporaryUrl requires a route. ' +
      'Call serveTemporaryUrls(router, { disk: "<name>", routePath: "..." }) in your bootstrap.'
    )
  }
  const path = this._tempUrlConfig.routePath.replace(':path*', encodeURI(filePath))
  return Url.sign(path, expiresAt)
}
```

`_tempUrlConfig` is set by `serveTemporaryUrls()` calling back into `LocalAdapter.serveAt(routePath)`.

### `LocalAdapter` — `temporaryUploadUrl`

**Throws `StorageNotSupportedError` in v1.** The "signed POST endpoint with multipart parsing" alternative is real but unwarranted for a local-dev driver — apps using local for production are vanishingly rare, and the workaround (`POST /api/upload` with normal middleware) is one route. Documented in the README under "Local adapter limitations".

### `LocalAdapter` — visibility

POSIX file mode bits with **a sidecar `.visibility` directory**:

| Visibility | File mode | Sidecar |
|---|---|---|
| `public`  | `0o644` | `<root>/.visibility/<path>` containing `'public'` |
| `private` | `0o600` | `<root>/.visibility/<path>` containing `'private'` |

`setVisibility` does `fs.chmod(abs, mode)` + writes the sidecar. `getVisibility` reads the sidecar (fallback: read mode bits and infer — `o600` → private, anything `o644+` → public).

The sidecar exists because:
- `chmod` alone is unreliable on Windows + on FUSE / mounted volumes.
- A SQLite metadata table is overkill (bootstraps a DB just for visibility).
- A single sidecar dir keeps storage browsable as plain files (the `local` driver's main job).

### `LocalAdapter` — streams

Trivial: `fs.createReadStream(abs)` and `fs.createWriteStream(abs)`. `writeStream` wraps `pipeline()` from `node:stream/promises` so back-pressure + errors propagate.

```ts
async writeStream(filePath: string, stream: Readable): Promise<void> {
  const abs = this.abs(filePath)
  await fs.mkdir(nodePath.dirname(abs), { recursive: true })
  const { createWriteStream } = await import('node:fs')
  const { pipeline } = await import('node:stream/promises')
  await pipeline(stream, createWriteStream(abs))
}
```

### `LocalAdapter` — copy/move/append/prepend

- `copy` — `fs.mkdir(parent, {recursive: true})` then `fs.copyFile`.
- `move` — `fs.rename` fast path; catch `EXDEV` and fall back to `copyFile + unlink` for cross-device moves.
- `append` — `fs.mkdir(parent)` + `fs.appendFile`.
- `prepend` — overrides `BaseAdapter` only if a faster path is wanted; default impl (read + concat + put) is fine.

---

## `FakeAdapter` — full contract in memory

```ts
// packages/storage/src/adapters/fake.ts
export class FakeAdapter extends BaseAdapter implements StorageAdapter {
  private files        = new Map<string, Buffer>()
  private visibilities = new Map<string, Visibility>()

  async put(p: string, c: Buffer | string) { this.files.set(p, typeof c === 'string' ? Buffer.from(c) : c) }
  async get(p: string)                     { return this.files.get(p) ?? null }
  async delete(p: string)                  { this.files.delete(p); this.visibilities.delete(p) }
  async exists(p: string)                  { return this.files.has(p) }
  async list(dir = '')                     {
    const prefix = dir ? `${dir.replace(/\/$/, '')}/` : ''
    return [...this.files.keys()].filter(k => k.startsWith(prefix))
  }
  url(p: string)                           { return `/fake/${p}` }
  path()                                   { throw new StorageNotSupportedError('fake', 'path') }

  async setVisibility(p: string, v: Visibility)        { this.visibilities.set(p, v) }
  async getVisibility(p: string): Promise<Visibility>  { return this.visibilities.get(p) ?? 'private' }

  async readStream(p: string): Promise<Readable> {
    const buf = this.files.get(p)
    if (!buf) throw new Error(`[RudderJS Storage] FakeAdapter.readStream: "${p}" not found.`)
    return Readable.from(buf)
  }
  async writeStream(p: string, stream: Readable) {
    const chunks: Buffer[] = []
    for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
    this.files.set(p, Buffer.concat(chunks))
  }

  async temporaryUrl(p: string, expiresAt: Date) {
    return `/fake/${p}?expires=${Math.floor(expiresAt.getTime() / 1000)}`
  }
  async temporaryUploadUrl(p: string, expiresAt: Date) {
    return { url: `/fake/upload/${p}?expires=${Math.floor(expiresAt.getTime() / 1000)}`, headers: {} }
  }

  async copy(from: string, to: string) {
    const buf = this.files.get(from)
    if (!buf) throw new Error(`[RudderJS Storage] FakeAdapter.copy: "${from}" not found.`)
    this.files.set(to, Buffer.from(buf))
  }
  // text(), move(), append(), prepend() inherited from BaseAdapter.

  // ─── assertions ───
  assertExists(p: string)           { assert.ok(this.files.has(p), `Expected "${p}" to exist on the fake disk.`) }
  assertMissing(p: string)          { assert.ok(!this.files.has(p), `Expected "${p}" to be missing on the fake disk.`) }
  assertCount(dir: string, n: number) {
    const prefix = dir ? `${dir.replace(/\/$/, '')}/` : ''
    const count  = [...this.files.keys()].filter(k => k.startsWith(prefix)).length
    assert.equal(count, n, `Expected ${n} files in "${dir}" on the fake disk, got ${count}.`)
  }
  assertDirectoryEmpty(dir: string) { this.assertCount(dir, 0) }

  reset(): void { this.files.clear(); this.visibilities.clear() }
}
```

### `Storage.fake()` — registry hook

```ts
private static _originalDisks = new Map<string, StorageAdapter>()
private static _fakes         = new Map<string, FakeAdapter>()

static fake(name?: string): FakeAdapter {
  const key = name ?? StorageRegistry.defaultName()       // new tiny accessor
  if (!Storage._originalDisks.has(key)) {
    try { Storage._originalDisks.set(key, StorageRegistry.get(key)) }
    catch { /* disk wasn't registered — fake fills the slot */ }
  }
  const existing = Storage._fakes.get(key)
  if (existing) { existing.reset(); return existing }
  const fake = new FakeAdapter()
  Storage._fakes.set(key, fake)
  StorageRegistry.set(key, fake)
  app().instance(`storage.${key}`, fake)                  // re-bind DI
  return fake
}

static restoreFakes(): void {
  for (const [k, orig] of Storage._originalDisks) StorageRegistry.set(k, orig)
  Storage._originalDisks.clear()
  Storage._fakes.clear()
}
```

---

## File touch list

| File | Change |
|---|---|
| `packages/storage/src/index.ts` | Widen `StorageAdapter` interface; export `Visibility`, `TemporaryUrlOptions`, `StorageNotSupportedError`; add `Storage.fake()` + `Storage.restoreFakes()`; add `StorageRegistry.defaultName()`. |
| `packages/storage/src/base.ts` *(new)* | `BaseAdapter` with default `move / append / prepend` impls. |
| `packages/storage/src/adapters/local.ts` *(new — split out)* | Move `LocalAdapter` here, extend `BaseAdapter`, add new methods. |
| `packages/storage/src/adapters/s3.ts` *(new — split out)* | Move `S3Adapter` here, extend `BaseAdapter`, add new methods + presigner imports. |
| `packages/storage/src/adapters/fake.ts` *(new)* | `FakeAdapter` with assertion helpers. |
| `packages/storage/src/serveTemporaryUrls.ts` *(new)* | Router-side helper for Local pre-signed URLs. |
| `packages/storage/src/index.test.ts` | Extend with new test groups (see Test plan). |
| `packages/storage/package.json` | Add `@aws-sdk/s3-request-presigner` + `@aws-sdk/lib-storage` to `optionalDependencies`; `@rudderjs/router` to `peerDependenciesMeta` as optional. |
| `packages/storage/README.md` | New sections: Pre-signed URLs, Visibility, Streams, Copy/Move, Testing with `Storage.fake()`. |
| `packages/storage/CHANGELOG.md` | Minor entry — additive only. |
| `.changeset/<random>.md` | Minor bump. |

The split into `src/adapters/*.ts` is a soft-required cleanup — `index.ts` is already 320 lines and triples in size with this PR. Mirrors the team's "Split logic into separate files per concern" rule (see memory `feedback_file_organization.md`).

---

## Test plan

`packages/storage/src/index.test.ts` already covers the existing surface. Add four groups:

### Group 1 — `FakeAdapter` (no I/O)

| Test | Assert |
|---|---|
| `Storage.fake()` returns a `FakeAdapter` and replaces the default disk | `Storage.disk()` instanceof `FakeAdapter`. |
| `Storage.fake('s3')` replaces a specific disk | Other disks untouched. |
| `Storage.fake()` is idempotent | Two calls return the same instance, but the in-memory store is reset. |
| `Storage.restoreFakes()` reverses the swap | Original adapter is back; fake instance is gone. |
| `assertExists / assertMissing / assertCount / assertDirectoryEmpty` | All pass for matching state, throw `AssertionError` for non-matching. |
| `readStream / writeStream` round-trip | A stream put + stream get returns the same bytes. |
| `copy / move / append / prepend` | Behave correctly on the fake. |
| `getVisibility` defaults to `'private'` for unset files | Returns `'private'`. |
| `temporaryUrl` returns a deterministic `/fake/...?expires=...` shape | Exact-string match. |

### Group 2 — `BaseAdapter` defaults (against `FakeAdapter`)

`BaseAdapter` is exercised through `FakeAdapter`. Verify that `move = copy + delete` and `append / prepend` survive empty / missing paths.

### Group 3 — `LocalAdapter` (uses `node:fs` + a tmp dir)

| Test | Assert |
|---|---|
| `setVisibility / getVisibility` round-trip | Mode bits + sidecar both set. |
| `getVisibility` falls back to mode bits when sidecar missing | `0o600` → `'private'`. |
| `readStream / writeStream` round-trip a 1 MB random buffer | Bytes equal. |
| `copy / move` cross-directory | New file exists; for `move`, old is gone. |
| `move` falls through `EXDEV` to copy + unlink | Mock `fs.rename` to throw `EXDEV`. |
| `append / prepend` | Read-back contents match expected concatenation. |
| `temporaryUrl` without `serveTemporaryUrls` registered | Throws with the helpful message. |
| `temporaryUrl` with `@rudderjs/router` not installed | Throws `StorageNotSupportedError`. |
| `temporaryUploadUrl` | Throws `StorageNotSupportedError`. |

### Group 4 — `S3Adapter` (mock the SDK)

The existing test file mocks `@aws-sdk/client-s3` via a fake module under `node_modules` — extend the mock to record commands. Tests assert **the right command was sent with the right shape**, not real network I/O.

| Test | Assert |
|---|---|
| `temporaryUrl` calls `getSignedUrl` with `GetObjectCommand` | Mock `getSignedUrl`; verify `expiresIn` math. |
| `temporaryUrl` passes through `responseContentDisposition / Type` | Command params include the override. |
| `temporaryUploadUrl` calls `getSignedUrl` with `PutObjectCommand` | Returns `{ url, headers }` shape. |
| `setVisibility('public')` sends `PutObjectAclCommand` with `ACL: 'public-read'` | Recorded command shape. |
| `getVisibility` parses `Grants` correctly | `AllUsers READ` → `'public'`. |
| `readStream` returns the Body | A small `Readable` mock is passed through. |
| `writeStream` calls `Upload(...).done()` | Mock `@aws-sdk/lib-storage`. |
| `copy` sends `CopyObjectCommand` with `CopySource: 'bucket/key'` | URL-encoded. |

---

## Open questions for the implementer

1. **S3 `Body` as `Readable`** — per AWS SDK v3 + `@smithy/util-stream`, `Body` is an `IncomingMessage` extending `Readable` on Node. Document as a Node-only branch (changes if we target Workers/Deno).
2. **Cross-disk `copy / move`** — single-disk in v1. Cross-disk = `Storage.copy({ from: 's3:a', to: 'local:b' })` shape, deferred to v2.
3. **Directory cascade for `setVisibility`** — no. Single file only, matching Laravel.
4. **`expiresAt > now` validation** — throw early; don't rely on `Math.max(1, ...)` to silently clamp.
5. **`Storage.fake()` and the DI binding** — provider binds `this.app.instance('storage', StorageRegistry.get())` at boot. `Storage.fake()` must re-bind via `app().instance('storage', fake)` so DI consumers see the swap. Document that callers holding a stashed reference to the original adapter keep it (rare — the facade is canonical).
6. **Sidecar visibility on Windows** — `fs.chmod` is a no-op there; sidecar wins. Document the implication.

---

## What this plan deliberately doesn't do

- **No SFTP / FTP drivers** — separate package when first asked.
- **No scoped disks** (`Storage.disk('s3').prefix('user-42/')`).
- **No explicit S3 multipart API** — `lib-storage`'s `Upload` covers it transparently for `writeStream`.
- **No upload validation middleware** — that's `@rudderjs/validation` form-request territory.
- **No object metadata get/set / `directories()` / `lastModified` / `size`** — easy v2 adds, no current consumer.

---

## Effort

~1.5 days. Every change is additive — no consumer migration. Adapter widening + `BaseAdapter` (1h), Local methods + sidecar (2h), S3 methods + presigner/lib-storage (2h), `FakeAdapter` + registry hook (2h), `serveTemporaryUrls` (1h), tests (3h), docs (1h).

---

## File path written

`/Users/sleman/Projects/rudder/docs/plans/2026-05-04-storage-temp-urls-visibility.md`
