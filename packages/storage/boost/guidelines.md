# @rudderjs/storage

## Overview

Filesystem facade for RudderJS. Provides a `Storage` facade, named disks, and driver registry. Ships with built-in `local` and `s3` drivers. Files written to the `public` disk become directly browser-accessible via a one-time `rudder storage:link` symlink (mirrors Laravel's `php artisan storage:link`).

## Key Patterns

### Registering the provider

```ts
// config/storage.ts
import path from 'node:path'
import { Env } from '@rudderjs/core'
import type { StorageConfig } from '@rudderjs/storage'

export default {
  default: Env.get('FILESYSTEM_DISK', 'local'),
  disks: {
    local:  { driver: 'local', root: path.resolve(process.cwd(), 'storage/app'), baseUrl: '/api/files' },
    public: { driver: 'local', root: path.resolve(process.cwd(), 'storage/app/public'),
              baseUrl: Env.get('APP_URL', 'http://localhost:3000') + '/storage' },
    s3:     { driver: 's3', bucket: Env.get('AWS_BUCKET', ''), region: Env.get('AWS_DEFAULT_REGION', 'us-east-1'),
              accessKeyId: Env.get('AWS_ACCESS_KEY_ID', ''), secretAccessKey: Env.get('AWS_SECRET_ACCESS_KEY', '') },
  },
} satisfies StorageConfig
```

```ts
// bootstrap/providers.ts — StorageProvider is auto-discovered, so nothing to import manually
import { defaultProviders } from '@rudderjs/core'

export default [...(await defaultProviders())]
```

To opt a project out of auto-discovery, import `StorageProvider` from `@rudderjs/storage` and list it explicitly.

### Reading and writing files

```ts
import { Storage } from '@rudderjs/storage'

await Storage.put('avatars/user-1.jpg', imageBuffer)

const buf   = await Storage.get('avatars/user-1.jpg')   // Buffer | null
const text  = await Storage.text('notes/readme.txt')    // string | null
const exists = await Storage.exists('avatars/user-1.jpg')

await Storage.delete('avatars/user-1.jpg')              // no-op if missing
const files = await Storage.list('avatars')             // string[] (files only)

const url = Storage.url('avatars/user-1.jpg')           // public URL
const abs = Storage.path('avatars/user-1.jpg')          // absolute path — local disks only
```

### Named disks

```ts
await Storage.disk('s3').put('backups/db.sql', data)
await Storage.disk('public').put('images/banner.png', buffer)
const url = Storage.disk('public').url('images/banner.png')
```

### Public disk + `storage:link`

Files on the `public` disk should be served as static assets (no API route needed). Once per project:

```bash
pnpm rudder storage:link
# creates public/storage → storage/app/public
```

Vite serves the `public/` directory at the root URL, so `storage/app/public/articles/photo.jpg` becomes `/storage/articles/photo.jpg` automatically.

Add these to `.gitignore`:

```
storage/app/
public/storage
```

Re-running `storage:link` is safe — it's idempotent.

### S3 / S3-compatible

```ts
{
  driver:           's3',
  bucket:           'my-bucket',
  region:           'us-east-1',
  endpoint:         'https://...',   // MinIO, Cloudflare R2, etc.
  forcePathStyle:   true,             // required for MinIO
  baseUrl:          'https://cdn.example.com',  // override url()
}
```

`@aws-sdk/client-s3` is an **optional** dependency — install it only if you use the `s3` driver:

```bash
pnpm add @aws-sdk/client-s3
```

### Pre-signed URLs

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
// browser PUTs to `url` with `headers`
```

`@aws-sdk/s3-request-presigner` is an optional dep, install it for S3 pre-signed URLs.

For the **local** driver, wire a signed route once in your bootstrap:

```ts
import { router } from '@rudderjs/router'
import { serveTemporaryUrls } from '@rudderjs/storage'

await serveTemporaryUrls(router, { disk: 'local', routePath: '/storage/temp/*' })
```

After that, `Storage.disk('local').temporaryUrl(filePath, expiresAt)` returns HMAC-signed URLs that the registered handler validates and serves. `LocalAdapter.temporaryUploadUrl()` throws — use a normal POST endpoint with multipart middleware in dev.

### Visibility, streams, file ops

```ts
await Storage.disk('s3').setVisibility('avatars/u-1.jpg', 'public')
const v = await Storage.disk('s3').getVisibility('avatars/u-1.jpg')

const stream = await Storage.disk('s3').readStream('big.zip')
await Storage.disk('local').writeStream('uploads/u.zip', uploadStream)

await Storage.copy('avatars/u-1.jpg', 'avatars/backup/u-1.jpg')
await Storage.move('tmp/upload.jpg', 'avatars/u-1.jpg')
await Storage.append('logs/app.log', 'request 42 OK\n')
await Storage.prepend('changelog.md', '# 1.2.0\n')
```

S3 streamed uploads use `@aws-sdk/lib-storage`'s `Upload` (handles multipart) — install only if you stream uploads to S3.

### Testing with `Storage.fake()`

```ts
import { Storage } from '@rudderjs/storage'

let disk: ReturnType<typeof Storage.fake>

beforeEach(() => { disk = Storage.fake() })
afterEach(()  => { Storage.restoreFakes() })

it('uploads an avatar', async () => {
  await Storage.put('avatars/u-1.jpg', Buffer.from([0xff]))
  disk.assertExists('avatars/u-1.jpg')
  disk.assertCount('avatars', 1)
  disk.assertDirectoryEmpty('logs')
})
```

`Storage.fake('s3')` swaps a specific named disk; `Storage.fake()` defaults to the configured default disk. Idempotent — calling twice resets the in-memory store. Both also re-bind the DI container key (`storage.<name>`) so injected consumers see the swap.

### Standalone use (tests / scripts)

```ts
import { LocalAdapter } from '@rudderjs/storage'

const disk = new LocalAdapter({ driver: 'local', root: '/tmp/uploads' })
await disk.put('file.txt', 'hello')
```

## Common Pitfalls

- **`@aws-sdk/client-s3` missing**: the S3 driver throws `Cannot find package '@aws-sdk/client-s3'` on boot if the disk is configured but the SDK isn't installed. It's an optional peer — install it when you add an `s3` disk.
- **`Storage.path()` throws on S3**: there is no local filesystem path for S3 objects. Use `Storage.url()` for a public reference instead.
- **Public disk without symlink**: writing to the `public` disk is fine, but the files won't be reachable at `/storage/...` until you run `pnpm rudder storage:link`.
- **`.gitignore` missing**: commit the `public/storage` symlink by accident and you pollute the repo with a dev-only path. Add both `storage/app/` and `public/storage` to `.gitignore`.
- **`list()` returns files only**: subdirectories are not included. If you need a recursive listing you have to walk manually.
- **`put()` auto-creates parents for `local`**: no need to `mkdir` first. `delete()` is a no-op when the file is missing — no try/catch needed.
- **`baseUrl` and `url()`**: the local driver's `url()` returns `baseUrl + '/' + path`. If `baseUrl` isn't configured, `url()` still works but produces a relative path — set it explicitly for browser-visible disks.
- **`temporaryUrl` on local without `serveTemporaryUrls()`**: throws "requires a route" — call `serveTemporaryUrls(router, { disk, routePath: '/storage/temp/*' })` once in your bootstrap.
- **`temporaryUrl({expiresAt})` in the past**: both adapters reject with "must be in the future". Always pass `new Date(Date.now() + ms)`.
- **`temporaryUploadUrl()` on local**: throws `StorageNotSupportedError` — there is no signed-POST equivalent in v1. Use a normal POST endpoint with multipart middleware.
- **`Storage.fake()` and DI**: re-binds `storage.<name>` in the container, so injected consumers also see the fake. Always call `Storage.restoreFakes()` in `afterEach`.
- **Visibility on Windows / FUSE**: `chmod` is unreliable. The Local adapter writes a sidecar in `<root>/.visibility/<path>` so `getVisibility()` still returns the right value.

## Key Imports

```ts
import {
  Storage,                 // facade (put/get/text/exists/delete/list/url/path/disk + new ops below)
  StorageProvider,         // service provider class (auto-discovered; import only to opt out)
  LocalAdapter,            // standalone local driver
  S3Adapter,               // standalone S3 driver
  FakeAdapter,             // returned by Storage.fake() — usually you don't import directly
  StorageRegistry,         // lookup adapters by name
  StorageNotSupportedError,// thrown when a driver can't do an op (e.g. LocalAdapter.temporaryUploadUrl)
  serveTemporaryUrls,      // wire LocalAdapter pre-signed URLs to a router route
} from '@rudderjs/storage'

import type {
  StorageConfig,
  StorageDiskConfig,
  LocalDiskConfig,
  S3DiskConfig,
  StorageAdapter,
  Visibility,
  TemporaryUrlOptions,
  TemporaryUploadUrl,
  ServeTemporaryUrlsOptions,
} from '@rudderjs/storage'
```
