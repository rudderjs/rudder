# @boostkit/storage

Storage facade, disk registry, and provider factory with local filesystem driver.

## Installation

```bash
pnpm add @boostkit/storage
```

## Setup

### 1. Configure storage

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
      endpoint:        Env.get('AWS_ENDPOINT', ''),
      baseUrl:         Env.get('AWS_URL', ''),
    },
  },
} satisfies StorageConfig
```

### 2. Register the provider

```ts
// bootstrap/providers.ts
import { storage } from '@boostkit/storage'
import configs from '../config/index.js'

export default [
  DatabaseServiceProvider,
  storage(configs.storage),
  AppServiceProvider,
]
```

## Storage Facade

```ts
import { Storage } from '@boostkit/storage'

// Write a file
await Storage.put('avatars/user-1.jpg', imageBuffer)

// Read a file as a Buffer
const buffer = await Storage.get('avatars/user-1.jpg')

// Read a file as a string
const content = await Storage.text('notes/readme.txt')

// Check if a file exists
const exists = await Storage.exists('avatars/user-1.jpg')

// Delete a file
await Storage.delete('avatars/user-1.jpg')

// Get the public URL for a file
const url = Storage.url('avatars/user-1.jpg')

// Absolute filesystem path (local driver only)
const abs = Storage.path('avatars/user-1.jpg')

// Access a named disk
await Storage.disk('public').put('images/banner.png', buffer)
```

### Methods

| Method              | Returns                   | Description                                                                 |
|---------------------|---------------------------|-----------------------------------------------------------------------------|
| `put(path, content)` | `Promise<void>`          | Write a file. `content` may be a `string`, `Buffer`, or `Uint8Array`.       |
| `get(path)`         | `Promise<Buffer \| null>` | Read a file as a `Buffer`. Returns `null` if the file does not exist.       |
| `text(path)`        | `Promise<string \| null>` | Read a file as a UTF-8 string. Returns `null` if the file does not exist.   |
| `exists(path)`      | `Promise<boolean>`        | Check whether a file exists at the given path.                              |
| `delete(path)`      | `Promise<void>`           | Delete a file. Does not throw if the file does not exist.                   |
| `list(directory?)`  | `Promise<string[]>`       | List files in a directory (relative paths, files only).                     |
| `url(path)`         | `string`                  | Return the public URL for the given path.                                   |
| `path(path)`        | `string`                  | Absolute filesystem path. Throws for S3 disks.                             |
| `disk(name?)`       | `StorageAdapter`          | Return a named disk instance.                                               |

## Public Disk & Symlink

The `public` disk is designed for files that should be directly accessible via HTTP — images, attachments, etc. — without routing through an API endpoint.

**How it works:**

1. `storage:link` creates a symlink: `public/storage → storage/app/public`
2. Vite serves the `public/` directory as static assets at the root URL
3. Files stored at `storage/app/public/articles/photo.jpg` are served at `/storage/articles/photo.jpg`

```bash
# Run once per project setup
pnpm artisan storage:link
# Linked: public/storage → storage/app/public
```

```ts
// Upload to the public disk
await Storage.disk('public').put('articles/photo.jpg', buffer)
const url = Storage.disk('public').url('articles/photo.jpg')
// → 'http://localhost:3000/storage/articles/photo.jpg'
```

Add to `.gitignore`:

```
storage/app/
public/storage
```

## `storage:link` Command

```bash
pnpm artisan storage:link
```

Creates `public/storage → storage/app/public`. Safe to re-run — prints `Link already exists.` if already linked.

## Configuration

### `StorageConfig`

```ts
interface StorageConfig {
  default: string
  disks: Record<string, DiskConfig>
}
```

| Field     | Type                        | Description                         |
|-----------|-----------------------------|-------------------------------------|
| `default` | `string`                    | Name of the default disk to use.    |
| `disks`   | `Record<string, DiskConfig>` | Named disk configurations.         |

### `LocalDiskConfig`

```ts
interface LocalDiskConfig {
  driver: 'local'
  root: string
  baseUrl?: string
}
```

| Option    | Type      | Description                                                                  |
|-----------|-----------|------------------------------------------------------------------------------|
| `driver`  | `'local'` | Must be `'local'` to select the built-in local filesystem driver.            |
| `root`    | `string`  | Absolute or relative path to the directory where files are stored.           |
| `baseUrl` | `string?` | Base URL prepended by `url()`. If omitted, defaults to `/storage`.           |

## `storage(config)`

`storage(config)` returns a BoostKit `ServiceProvider` class that registers the configured disks and binds the `Storage` facade during `boot()`.

## Notes

- The `Storage` facade always operates on the `default` disk unless you call `Storage.disk(name)`.
- `url()` prepends `baseUrl` when configured.
- The `local` driver creates parent directories automatically — no need to `mkdir` first.
- `delete()` is a no-op if the file does not exist.
- `list()` returns only files (not subdirectories) in the given directory.
- `path()` throws for S3 disks — use `url()` for a public reference instead.
- For S3-compatible object storage (AWS S3, Cloudflare R2, MinIO), see the [S3 driver](./s3) — built into `@boostkit/storage`, requires `@aws-sdk/client-s3`.
