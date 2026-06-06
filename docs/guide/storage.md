# File Storage

`@rudderjs/storage` is the framework's filesystem abstraction. It provides a unified API for reading, writing, and serving files across local disk, S3, R2, and MinIO. Switching storage backends — from local in development to S3 in production — is a config change, not a code change.

## Setup

```bash
pnpm add @rudderjs/storage
```

For S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO, DigitalOcean Spaces):

```bash
pnpm add @aws-sdk/client-s3
```

```ts
// config/storage.ts
import path from 'node:path'
import { Env } from '@rudderjs/support'
import type { StorageConfig } from '@rudderjs/storage'

export default {
  default: Env.get('FILESYSTEM_DISK', 'local'),
  disks: {
    local: {
      driver:  'local',
      root:    path.resolve(process.cwd(), 'storage/app'),
      baseUrl: '/api/files',
    },
    public: {
      driver:  'local',
      root:    path.resolve(process.cwd(), 'storage/app/public'),
      baseUrl: Env.get('APP_URL', 'http://localhost:3000') + '/storage',
    },
    s3: {
      driver:          's3',
      bucket:          Env.get('AWS_BUCKET', ''),
      region:          Env.get('AWS_DEFAULT_REGION', 'us-east-1'),
      accessKeyId:     Env.get('AWS_ACCESS_KEY_ID', ''),
      secretAccessKey: Env.get('AWS_SECRET_ACCESS_KEY', ''),
      endpoint:        Env.get('AWS_ENDPOINT', ''),     // R2/MinIO/Spaces — leave empty for AWS
      baseUrl:         Env.get('AWS_URL', ''),
    },
  },
} satisfies StorageConfig
```

The provider is auto-discovered.

## The Storage facade

```ts
import { Storage } from '@rudderjs/storage'

await Storage.put('avatars/user-1.jpg', buffer)
const data = await Storage.get('avatars/user-1.jpg')      // Buffer | null
const text = await Storage.text('notes/readme.txt')       // string | null
const ok   = await Storage.exists('avatars/user-1.jpg')
await Storage.delete('avatars/user-1.jpg')
const url  = Storage.url('avatars/user-1.jpg')

// Named disks
await Storage.disk('public').put('images/banner.png', buffer)
await Storage.disk('s3').put('uploads/file.pdf', buffer)
```

| Method | Returns | Description |
|---|---|---|
| `put(path, content)` | `Promise<void>` | Write — `Buffer \| string` |
| `get(path)` | `Promise<Buffer \| null>` | Read as Buffer |
| `text(path)` | `Promise<string \| null>` | Read as UTF-8 |
| `exists(path)` | `Promise<boolean>` | Check existence |
| `delete(path)` | `Promise<void>` | Remove (no-op if missing) |
| `list(directory?)` | `Promise<string[]>` | List relative file paths |
| `url(path)` | `string` | Public URL for the file |
| `path(path)` | `string` | Absolute filesystem path (local driver only) |
| `disk(name?)` | `StorageAdapter` | Named disk instance |

## The public disk

The `public` disk is for files that should be served directly over HTTP — avatars, attachments, generated assets — without going through an API endpoint. The framework sets this up via a symlink:

```bash
pnpm rudder storage:link    # public/storage → storage/app/public
```

Vite serves `public/` at the URL root, so `Storage.disk('public').put('articles/photo.jpg', buf)` ends up at `/storage/articles/photo.jpg`.

For files that need access control, use the `local` disk and serve them through a route handler that checks the request's user before piping the bytes back:

```ts
Route.get('/api/files/:id', async (req, res) => {
  await Gate.authorize('view-file', file)
  const buffer = await Storage.get(file.path)
  if (!buffer) return res.status(404).send('Not found')
  return res.header('Content-Type', file.mimeType).send(buffer)
})
```

## S3 / R2 / MinIO

The `s3` driver works with any S3-compatible service. Set `endpoint` for non-AWS providers:

```dotenv
# AWS S3
AWS_BUCKET=my-app
AWS_DEFAULT_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Cloudflare R2
AWS_ENDPOINT=https://<account>.r2.cloudflarestorage.com
AWS_URL=https://files.example.com   # custom domain pointing at the bucket

# MinIO
AWS_ENDPOINT=http://localhost:9000
AWS_URL=http://localhost:9000/my-app
```

For pre-signed URLs (temporary direct browser access):

```ts
const url = await Storage.disk('s3').temporaryUrl('uploads/file.pdf', new Date(Date.now() + 3600_000))  // 1-hour link
```

## Temporary URLs on the local disk

The local disk has no bucket of its own, so `temporaryUrl()` issues an HMAC-signed URL that points at a controller route the framework registers for you. Wire it once in your bootstrap:

```ts
import { router } from '@rudderjs/router'
import { serveTemporaryUrls } from '@rudderjs/storage'

await serveTemporaryUrls(router, { disk: 'local', routePath: '/storage/temp/*' })
```

After that, `Storage.disk('local').temporaryUrl('uploads/file.pdf', new Date(Date.now() + 3600_000))` returns a URL of the form `/storage/temp/uploads/file.pdf?expires=...&signature=...`. The registered handler validates the signature and streams the file. Useful in dev so the same `temporaryUrl()` call works locally without S3.

`serveTemporaryUrls()` is `async` because it dynamic-imports `@rudderjs/router` to read `Url.isValidSignature`. Don't forget to `await` it. `temporaryUploadUrl()` on the local disk throws `StorageNotSupportedError` — there is no signed-POST equivalent in v1.

## Visibility

Set or read per-file visibility independently of the disk's defaults:

```ts
await Storage.disk('s3').setVisibility('avatars/u-1.jpg', 'public')
const v = await Storage.disk('s3').getVisibility('avatars/u-1.jpg')   // 'public' | 'private'
```

S3 maps `public` → `public-read` ACL and `private` → `private` ACL via `PutObjectAcl`/`GetObjectAcl`. The local adapter writes mode bits (`0o644` / `0o600`) **and** a sidecar at `<root>/.visibility/<path>` so Windows and FUSE volumes still report correctly. `delete()` removes the sidecar.

`put()` takes no options argument, so set visibility in a follow-up call:

```ts
await Storage.put('reports/q1.pdf', buffer)
await Storage.setVisibility('reports/q1.pdf', 'public')
```

## Streams

For files larger than a few MB, prefer streams over `get()` / `put()` to avoid buffering the whole payload in memory:

```ts
const stream = await Storage.disk('s3').readStream('big.zip')
stream.pipe(res)                                              // 200 MB safe — no buffering

await Storage.disk('local').writeStream('uploads/u.zip', uploadStream)   // resolves on flush
```

S3 reads return the SDK's `GetObject` `Body` directly; uploads route through `@aws-sdk/lib-storage`'s `Upload` helper (multipart is automatic). The local adapter uses `node:fs` `createReadStream` / `createWriteStream` with `pipeline()` for back-pressure.

## File uploads

Multipart uploads parse into `req.body` as a structure with named files. Persist them with `Storage.put()`:

```ts
Route.post('/api/avatars', async (req, res) => {
  const file: File = (req.body as any).avatar
  const path = `avatars/${req.user.id}/${file.name}`
  await Storage.disk('s3').put(path, Buffer.from(await file.arrayBuffer()))
  return res.status(201).json({ url: Storage.disk('s3').url(path) })
})
```

For large uploads (over a few MB), prefer client-direct uploads with `temporaryUrl()` so files don't transit your server.

## Custom drivers

Implement `StorageAdapter` for FTP, Backblaze native API, IPFS, etc. Register with `StorageRegistry.set('my-driver', adapter)`.

## Testing

`Storage.fake()` returns a `FakeAdapter` instance — assertions live on the returned fake, not on `Storage`:

```ts
import { Storage } from '@rudderjs/storage'

const disk = Storage.fake()              // swap the default disk
const s3   = Storage.fake('s3')          // swap a named disk

await someCodeThatUploads()

disk.assertExists('avatars/user-1.jpg')
disk.assertMissing('avatars/user-2.jpg')
disk.assertCount('avatars/', 1)          // exactly one file under avatars/
disk.assertDirectoryEmpty('reports/')

Storage.restoreFakes()                   // afterEach — reverse every fake() swap
```

The fake records writes in memory and never touches the disk or network. Call `Storage.restoreFakes()` in `afterEach` so subsequent tests see the real disks again.

## Pitfalls

- **Forgetting `pnpm rudder storage:link`.** The public disk's URLs return 404 until the symlink exists. Run `storage:link` once after scaffolding.
- **Missing `@aws-sdk/client-s3`.** It's an optional peer dependency. The S3 disk throws at boot if not installed.
- **Calling `Storage.path(...)` on an S3 disk.** Throws — there's no filesystem path for remote files. Use `url()` or `temporaryUrl()` instead.
- **Public disk with sensitive files.** Anything written to the public disk is reachable by URL. For access-controlled files, use the local disk and serve through an authenticated route.
- **Forgetting `await serveTemporaryUrls(...)`.** It's `async` (dynamic-imports `@rudderjs/router`). Without `await`, the route never registers and `temporaryUrl()` returns 404s.
- **Cross-disk `move()` / `copy()`.** These are single-disk in v1 — calls that span disks throw an explicit error. Use `get()` + `put()` to bridge disks.
- **`temporaryUploadUrl()` on local disk.** Throws `StorageNotSupportedError` — there is no signed-POST equivalent for the local adapter. In dev, use a normal `POST /api/upload` with multipart middleware.
