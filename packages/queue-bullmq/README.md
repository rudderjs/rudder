# @boostkit/queue-bullmq

BullMQ adapter provider for `@boostkit/queue` with Redis-backed dispatch and workers.

## Installation

```bash
pnpm add @boostkit/queue-bullmq
```

## Usage

```ts
import { bullmq } from '@boostkit/queue-bullmq'

const provider = bullmq({
  host: '127.0.0.1',
  port: 6379,
  prefix: 'boostkit',
  jobs: [],
})

const adapter = provider.create()
```

## API Reference

- `BullMQConfig`
- `bullmq(config?)` → `QueueAdapterProvider`

## Configuration

- `BullMQConfig`
  - `driver?`, `url?`
  - `host?`, `port?`, `password?`
  - `prefix?`
  - `jobs?`

## Notes

- Uses `bullmq` and Redis.
- Register all job classes in `jobs` so worker execution can resolve by job name.
