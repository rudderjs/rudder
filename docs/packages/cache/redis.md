# Redis Driver

Redis cache adapter built into `@rudderjs/cache` via ioredis.

## Installation

```bash
pnpm add ioredis
```

## Setup

Add a `redis` store to your cache configuration:

```ts
// config/cache.ts
import type { CacheConfig } from '@rudderjs/cache'

export default {
  default: Env.get('CACHE_DRIVER', 'redis'),
  stores: {
    memory: {
      driver: 'memory',
    },
    redis: {
      driver: 'redis',
      host: Env.get('REDIS_HOST', '127.0.0.1'),
      port: Env.getNumber('REDIS_PORT', 6379),
      password: Env.get('REDIS_PASSWORD'),
      db: Env.getNumber('REDIS_DB', 0),
      prefix: 'rudderjs:cache:',
    },
  },
} satisfies CacheConfig
```

No changes are needed in `bootstrap/providers.ts` — `@rudderjs/cache` automatically uses the Redis driver when it sees `driver: 'redis'` in a store config.

## Configuration

### `RedisCacheConfig`

| Option     | Type      | Description                                                                 |
|------------|-----------|-----------------------------------------------------------------------------|
| `driver`   | `'redis'` | Must be `'redis'` to select this adapter.                                   |
| `host`     | `string?` | Redis server hostname. Defaults to `'127.0.0.1'`.                          |
| `port`     | `number?` | Redis server port. Defaults to `6379`.                                      |
| `password` | `string?` | Redis auth password. Omit if not set.                                       |
| `db`       | `number?` | Redis database index. Defaults to `0`.                                      |
| `url`      | `string?` | Full Redis connection URL (e.g. `redis://:<password>@host:6379/0`). Takes priority over `host`/`port` when provided. |
| `prefix`   | `string?` | Key prefix applied to all cache keys. Useful for namespacing in shared Redis instances. |

## Notes

- Set a `prefix` to namespace keys when sharing a Redis instance across multiple applications or environments.
- When `url` is provided it takes priority over individual `host`, `port`, `password`, and `db` fields.
- The underlying ioredis client handles reconnection automatically.
- In a multi-process or multi-instance deployment, use the Redis driver so counters are shared across instances (important for rate limiting).
