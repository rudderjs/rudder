# @boostkit/storage

Storage facade, disk registry, and provider factory with built-in `local` and `s3` drivers.

## Installation

```bash
pnpm add @boostkit/storage
```

## Setup

```ts
// config/storage.ts
import path from 'node:path'
import { Env } from '@boostkit/core'
import type { StorageConfig } from '@boostkit/storage'

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
import { storage } from '@boostkit/storage'
import configs from '../config/index.js'

export default [storage(configs.storage)]
```

## Storage Facade

```ts
import { Storage } from '@boostkit/storage'

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
pnpm artisan storage:link
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
pnpm artisan storage:link
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
import { LocalAdapter } from '@boostkit/storage'

const disk = new LocalAdapter({ driver: 'local', root: '/tmp/uploads' })
await disk.put('file.txt', 'hello')
```

## Notes

- `local` driver creates parent directories automatically — no need to `mkdir` first.
- `delete()` is a no-op if the file does not exist.
- `list()` returns only files (not subdirectories) in the given directory.
- `path()` throws for S3 disks — use `url()` for a public reference instead.
- S3 requires `pnpm add @aws-sdk/client-s3` — it is an optional dependency.
