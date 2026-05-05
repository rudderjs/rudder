# @rudderjs/storage

Storage facade, disk registry, and provider factory with built-in `local` and `s3` drivers.

## Installation

```bash
pnpm add @rudderjs/storage
```

## Setup

```ts
// config/storage.ts
import path from 'node:path'
import { Env } from '@rudderjs/core'
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
    },
  },
} satisfies StorageConfig
```

```ts
// bootstrap/providers.ts
import { defaultProviders } from '@rudderjs/core'

export default [...(await defaultProviders())]
```

`StorageProvider` is auto-discovered — it boots all configured disks and registers the storage facade in the DI container as `storage` (default disk) and `storage.<name>` (each named disk).

## Storage Facade

```ts
import { Storage } from '@rudderjs/storage'

// Write a file
await Storage.put('avatars/user-1.jpg', imageBuffer)

// Read as Buffer
const buf = await Storage.get('avatars/user-1.jpg')

// Read as string
const text = await Storage.text('notes/readme.txt')

// Check existence
const exists = await Storage.exists('avatars/user-1.jpg')

// Delete a file
await Storage.delete('avatars/user-1.jpg')

// List files in a directory
const files = await Storage.list('avatars')

// Public URL
const url = Storage.url('avatars/user-1.jpg')

// Absolute filesystem path (local driver only)
const abs = Storage.path('avatars/user-1.jpg')

// Access a specific named disk
await Storage.disk('s3').put('backups/db.sql', data)
await Storage.disk('public').put('images/banner.png', buffer)
```

## Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `put(path, contents)` | `Promise<void>` | Write a file. Creates parent directories automatically. |
| `get(path)` | `Promise<Buffer \| null>` | Read a file as a Buffer. `null` if missing. |
| `text(path)` | `Promise<string \| null>` | Read a file as a UTF-8 string. `null` if missing. |
| `exists(path)` | `Promise<boolean>` | Check if a file exists. |
| `delete(path)` | `Promise<void>` | Delete a file. No-op if missing. |
| `list(directory?)` | `Promise<string[]>` | List files in a directory (relative paths). |
| `url(path)` | `string` | Public URL for the file. |
| `path(path)` | `string` | Absolute filesystem path. Throws for S3 disks. |
| `disk(name)` | `StorageAdapter` | Access a named disk directly. |
| `copy(from, to)` | `Promise<void>` | Copy a file within the same disk. |
| `move(from, to)` | `Promise<void>` | Rename / move a file within the same disk. |
| `append(path, contents)` | `Promise<void>` | Append `contents` to a file. Creates the file if it doesn't exist. |
| `prepend(path, contents)` | `Promise<void>` | Prepend `contents` to a file. Creates the file if it doesn't exist. |
| `setVisibility(path, v)` | `Promise<void>` | Set per-file visibility (`'public'` or `'private'`). |
| `getVisibility(path)` | `Promise<Visibility>` | Read per-file visibility. Defaults to `'private'`. |
| `readStream(path)` | `Promise<Readable>` | Read a file as a Node `Readable` stream. |
| `writeStream(path, stream)` | `Promise<void>` | Pipe a `Readable` into a file. |
| `temporaryUrl(path, expiresAt, opts?)` | `Promise<string>` | Short-lived signed download URL. |
| `temporaryUploadUrl(path, expiresAt)` | `Promise<{url, headers}>` | Short-lived signed upload URL. |

## Configuration

### `StorageConfig`

```ts
interface StorageConfig {
  default: string
  disks: Record<string, StorageDiskConfig>
}
```

### `LocalDiskConfig`

```ts
{
  driver:   'local',
  root:     'storage/app',   // absolute or relative path
  baseUrl?: '/api/files',    // prefix for url()
}
```

### `S3DiskConfig`

```ts
{
  driver:           's3',
  bucket:           'my-bucket',
  region?:          'us-east-1',
  accessKeyId?:     '...',
  secretAccessKey?: '...',
  endpoint?:        'https://...',   // S3-compatible (MinIO, Cloudflare R2)
  forcePathStyle?:  true,            // required for MinIO
  baseUrl?:         'https://cdn.example.com',   // override url() base
}
```

## Public Disk & Symlink

The `public` disk stores files that should be directly accessible via HTTP — images, PDFs, etc. Unlike the `local` disk (which requires an API route to serve files), files on the `public` disk are served as static assets by Vite.

**1. Configure the `public` disk** (already the default in the config above):

```ts
public: {
  driver:  'local',
  root:    path.resolve(process.cwd(), 'storage/app/public'),
  baseUrl: Env.get('APP_URL', 'http://localhost:3000') + '/storage',
},
```

**2. Create the symlink** once per project:

```bash
pnpm rudder storage:link
# Linked: public/storage → storage/app/public
```

This creates `public/storage → storage/app/public`. Vite serves the `public/` directory as static assets at the root URL, so files stored at `storage/app/public/articles/photo.jpg` become immediately accessible at `/storage/articles/photo.jpg` — no API route needed.

**3. Upload to the `public` disk:**

```ts
await Storage.disk('public').put('articles/photo.jpg', buffer)
const url = Storage.disk('public').url('articles/photo.jpg')
// → 'http://localhost:3000/storage/articles/photo.jpg'
```

Add `public/storage` and `storage/app/` to `.gitignore`:

```
storage/app/
public/storage
```

## `storage:link` Command

```bash
pnpm rudder storage:link
```

Creates a symlink from `public/storage` to `storage/app/public`. Re-running when the link already exists is safe — it prints `Link already exists.` and exits.

## Built-in Drivers

### `local`

Writes files to the local filesystem. Creates parent directories automatically on `put()`. Use the `public` disk variant with `storage:link` for browser-accessible files.

### `s3`

AWS S3, Cloudflare R2, MinIO, or any S3-compatible service. Requires `@aws-sdk/client-s3`.

```bash
pnpm add @aws-sdk/client-s3
```

```ts
{ driver: 's3', bucket: 'my-bucket', region: 'us-east-1' }
```

## `LocalAdapter`

Exported for standalone use without the provider:

```ts
import { LocalAdapter } from '@rudderjs/storage'

const disk = new LocalAdapter({ driver: 'local', root: '/tmp/uploads' })
await disk.put('file.txt', 'hello')
```

## Pre-signed URLs

### S3

S3 disks issue real pre-signed URLs through `@aws-sdk/s3-request-presigner` (an optional dep — install only if you use S3).

```ts
const url = await Storage.disk('s3').temporaryUrl(
  'invoices/2026-05.pdf',
  new Date(Date.now() + 60_000),
  { responseContentDisposition: 'attachment; filename="may.pdf"' },
)

const { url, headers } = await Storage.disk('s3').temporaryUploadUrl(
  'uploads/u-42/avatar.jpg',
  new Date(Date.now() + 5 * 60_000),
)
// Browser PUTs the file to `url` with `headers`.
```

### Local

The Local adapter has no bucket of its own, so it issues HMAC-signed URLs that point at a controller route the framework registers for you. Wire it once in your bootstrap:

```ts
import { router } from '@rudderjs/router'
import { serveTemporaryUrls } from '@rudderjs/storage'

await serveTemporaryUrls(router, { disk: 'local', routePath: '/storage/temp/*' })
```

After that, `Storage.disk('local').temporaryUrl(...)` returns URLs of the form `/storage/temp/<path>?expires=...&signature=...` and the registered handler validates the signature + streams the file.

`LocalAdapter.temporaryUploadUrl()` throws `StorageNotSupportedError` — there is no signed-POST equivalent in v1. Use a normal `POST /api/upload` route with multipart middleware in dev.

## Visibility

```ts
await Storage.disk('s3').setVisibility('avatars/u-1.jpg', 'public')
const v = await Storage.disk('s3').getVisibility('avatars/u-1.jpg')   // 'public' | 'private'
```

S3 maps `public` to the `public-read` ACL and `private` to the `private` ACL via `PutObjectAclCommand` / `GetObjectAclCommand`. The Local adapter writes mode bits (`0o644` for public, `0o600` for private) plus a sidecar entry in `<root>/.visibility/<path>` so Windows / FUSE volumes still report correctly. `delete()` removes the sidecar too.

## Streams

```ts
const stream = await Storage.disk('s3').readStream('big.zip')
stream.pipe(res)                                          // 200 MB safe — no buffering

await Storage.disk('local').writeStream('uploads/u.zip', uploadStream)   // resolves on flush
```

S3 reads return the SDK's `GetObjectCommand` `Body` (a Node `Readable`) directly; uploads use `@aws-sdk/lib-storage`'s `Upload` helper (multipart automatic). Local uses `node:fs` `createReadStream` / `createWriteStream` with `pipeline()` for back-pressure.

## File operations

```ts
await Storage.copy('avatars/u-1.jpg', 'avatars/backup/u-1.jpg')
await Storage.move('tmp/upload.jpg', 'avatars/u-1.jpg')   // S3: copy + delete; Local: rename (EXDEV → copy + unlink)
await Storage.append('logs/app.log', 'request 42 OK\n')
await Storage.prepend('changelog.md', '# 1.2.0\n')
```

`copy / move` are single-disk in v1 — cross-disk moves throw an explicit error (deferred to v2).

## Testing with `Storage.fake()`

```ts
import { Storage } from '@rudderjs/storage'

let disk: ReturnType<typeof Storage.fake>

beforeEach(() => { disk = Storage.fake() })           // swaps the default disk for an in-memory FakeAdapter
afterEach(()  => { Storage.restoreFakes() })          // puts the original adapter back

it('uploads an avatar', async () => {
  await Storage.put('avatars/u-1.jpg', Buffer.from([0xff]))
  disk.assertExists('avatars/u-1.jpg')
  disk.assertCount('avatars', 1)
  disk.assertDirectoryEmpty('logs')
})
```

`Storage.fake('s3')` swaps a specific disk; `Storage.fake()` defaults to whatever disk is currently configured as default. Calling `Storage.fake()` twice keeps the same `FakeAdapter` instance and resets its in-memory store. Both `fake()` and `restoreFakes()` re-bind the DI container (`storage.<name>`) so consumers that injected the disk see the swap too.

## Notes

- `local` driver creates parent directories automatically — no need to `mkdir` first.
- `delete()` is a no-op if the file does not exist.
- `list()` returns only files (not subdirectories) in the given directory.
- `path()` throws for S3 disks — use `url()` for a public reference instead.
- S3 requires `pnpm add @aws-sdk/client-s3` — it is an optional dependency. Pre-signed URLs additionally need `@aws-sdk/s3-request-presigner`; streamed uploads need `@aws-sdk/lib-storage`. All three are optional.
- `temporaryUrl()` / `temporaryUploadUrl()` throw if `expiresAt <= Date.now()`.
