# @boostkit/cache

Cache facade, cache registry, and provider factory with an in-memory built-in driver.

## Installation

```bash
pnpm add @boostkit/cache
```

## Usage

```ts
// bootstrap/providers.ts
import { cache } from '@boostkit/cache'
import configs from '../config/index.js'

export default [
  cache(configs.cache),
]

// anywhere after boot
import { Cache } from '@boostkit/cache'
await Cache.set('users:count', 10, 60)
const count = await Cache.get<number>('users:count')
```

## API Reference

- `CacheAdapter`, `CacheAdapterProvider`
- `CacheRegistry`
- `Cache`
- `CacheStoreConfig`, `CacheConfig`
- `cache(config)`

## Configuration

- `CacheConfig`
  - `default`
  - `stores`
- `CacheStoreConfig`
  - `driver`
  - additional driver-specific keys

## Notes

- Built-in driver: `memory`.
- Plugin driver supported by factory: `redis` (via `@boostkit/cache-redis`).
