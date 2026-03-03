# @boostkit/rate-limit

Cache-backed rate limit middleware builder with standard rate-limit headers.

## Installation

```bash
pnpm add @boostkit/rate-limit
```

## Usage

```ts
import { RateLimit } from '@boostkit/rate-limit'

const limiter = RateLimit
  .perMinute(60)
  .byIp()
  .message('Too many requests')
  .toHandler()

// use limiter in route/global middleware registration
```

## API Reference

- `RateLimitBuilder`
  - `byIp()`, `byRoute()`, `by(fn)`
  - `message(msg)`, `skipIf(fn)`
  - `toHandler()`
- `RateLimit`
  - `perMinute(max)`, `perHour(max)`, `perDay(max)`, `per(max, windowMs)`

## Configuration

This package has no runtime config object.

## Notes

- Requires a cache adapter registered in `@boostkit/cache` (`memory` or `redis`).
- Skips static assets and Vite internal paths automatically.
