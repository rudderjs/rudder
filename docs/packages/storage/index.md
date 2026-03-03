# @forge/storage

Storage facade, disk registry, and provider factory with local filesystem driver.

## Installation

```bash
pnpm add @forge/storage
```

## Setup

### 1. Configure storage

```ts
// config/storage.ts
import type { StorageConfig } from '@forge/storage'

export default {
  default: Env.get('STORAGE_DRIVER', 'local'),
  disks: {
    local: {
      driver: 'local',
      root: './storage/app',
      baseUrl: Env.get('APP_URL', 'http://localhost:3000') + '/storage',
    },
    public: {
      driver: 'local',
      root: './storage/public',
      baseUrl: Env.get('APP_URL', 'http://localhost:3000') + '/storage/public',
    },
  },
} satisfies StorageConfig
```

### 2. Register the provider

```ts
// bootstrap/providers.ts
import { storage } from '@forge/storage'
import configs from '../config/index.js'

export default [
  DatabaseServiceProvider,
  storage(configs.storage),
  AppServiceProvider,
]
```

## Storage Facade

```ts
import { Storage } from '@forge/storage'

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
```

### Methods

| Method              | Returns                   | Description                                                                 |
|---------------------|---------------------------|-----------------------------------------------------------------------------|
| `put(path, content)` | `Promise<void>`          | Write a file. `content` may be a `string`, `Buffer`, or `Uint8Array`.       |
| `get(path)`         | `Promise<Buffer \| null>` | Read a file as a `Buffer`. Returns `null` if the file does not exist.       |
| `text(path)`        | `Promise<string \| null>` | Read a file as a UTF-8 string. Returns `null` if the file does not exist.   |
| `exists(path)`      | `Promise<boolean>`        | Check whether a file exists at the given path.                              |
| `delete(path)`      | `Promise<void>`           | Delete a file. Does not throw if the file does not exist.                   |
| `url(path)`         | `string`                  | Return the public URL for the given path. Uses `baseUrl` if configured.     |
| `disk(name?)`       | `StorageDisk`             | Return a named disk instance. Omit `name` to use the default disk.          |

### Using a Named Disk

```ts
import { Storage } from '@forge/storage'

const publicDisk = Storage.disk('public')
await publicDisk.put('images/banner.png', buffer)
const url = publicDisk.url('images/banner.png')
```

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
| `baseUrl` | `string?` | Base URL prepended by `url()`. If omitted, `url()` returns the relative path. |

## `storage(config)`

`storage(config)` returns a Forge `ServiceProvider` class that registers the configured disks and binds the `Storage` facade during `boot()`.

## `storage:link` Command

The `storage:link` artisan command creates a symbolic link from your public web directory to a storage disk, making files publicly accessible via HTTP.

```bash
pnpm artisan storage:link
```

Configure the link targets in your storage config or use the defaults. The local development server must be configured to serve files from the linked directory.

## Notes

- The `Storage` facade always operates on the `default` disk unless you call `Storage.disk(name)`.
- `url()` prepends `baseUrl` when configured. If `baseUrl` is not set, it returns the relative file path.
- For S3-compatible object storage (AWS S3, Cloudflare R2, MinIO), use the [`@forge/storage-s3`](./s3) adapter.
