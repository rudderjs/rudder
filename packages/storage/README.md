# @boostkit/storage

Storage facade, disk registry, and provider factory with a local filesystem driver.

## Installation

```bash
pnpm add @boostkit/storage
```

## Usage

```ts
// bootstrap/providers.ts
import { storage } from '@boostkit/storage'
import configs from '../config/index.js'

export default [
  storage(configs.storage),
]

import { Storage } from '@boostkit/storage'
await Storage.put('avatars/a.txt', 'hello')
const text = await Storage.text('avatars/a.txt')
```

## API Reference

- `StorageAdapter`, `StorageAdapterProvider`
- `StorageRegistry`
- `Storage`
- `LocalDiskConfig`
- `StorageDiskConfig`, `StorageConfig`
- `storage(config)`

## Configuration

- `StorageConfig`
  - `default`
  - `disks`
- `StorageDiskConfig`
  - `driver`
  - additional driver-specific keys
- `LocalDiskConfig`
  - `driver` (`'local'`)
  - `root`
  - `baseUrl?`

## Notes

- Built-in driver: `local`.
- Plugin driver supported by factory: `s3` (via `@boostkit/storage-s3`).
- Registers `storage:link` artisan command.
