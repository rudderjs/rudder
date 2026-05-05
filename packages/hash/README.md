# @rudderjs/hash

One-way password hashing for RudderJS. Built-in drivers: **bcrypt** (default) and **argon2**.

## Installation

```bash
pnpm add @rudderjs/hash
```

For argon2 support:

```bash
pnpm add argon2
```

## Setup

```ts
// config/hash.ts
export default {
  driver: 'bcrypt',
  bcrypt: { rounds: 12 },
  argon2: { memory: 65536, time: 3, threads: 4 },
}

// bootstrap/providers.ts
import { HashProvider } from '@rudderjs/hash'
export default [HashProvider]
```

## Usage

```ts
import { Hash } from '@rudderjs/hash'

// Hash a password
const hashed = await Hash.make('password')

// Verify a password
const valid = await Hash.check('password', hashed) // true

// Check if rehash is needed (e.g. after changing rounds)
if (Hash.needsRehash(hashed)) {
  const newHash = await Hash.make('password')
}
```

## Drivers

### Bcrypt (default)

Uses `bcryptjs` (pure JS, no native compilation needed).

| Option | Default | Description |
|--------|---------|-------------|
| `rounds` | `12` | Cost factor (2^rounds iterations) |

### Argon2

Uses the `argon2` package (native, requires compilation). Uses argon2id variant.

| Option | Default | Description |
|--------|---------|-------------|
| `memory` | `65536` | Memory cost in KiB |
| `time` | `3` | Time cost (iterations) |
| `threads` | `4` | Parallelism factor |
