# @boostkit/auth-better-auth

better-auth service provider factory for Forge applications.

## Installation

```bash
pnpm add @boostkit/auth-better-auth
```

## Usage

```ts
// bootstrap/providers.ts
import { betterAuth } from '@boostkit/auth-better-auth'
import configs from '../config/index.js'

export default [
  betterAuth(configs.auth),
]
```

## API Reference

- `BetterAuthConfig`
- `betterAuth(config)`
- `BetterAuthInstance`

## Configuration

- `BetterAuthConfig`
  - `secret?`, `baseUrl?`
  - `database`
  - `databaseProvider?`
  - `emailAndPassword?`
  - `socialProviders?`
  - `trustedOrigins?`
  - `onUserCreated?`

## Notes

- Binds auth instance in DI container under token `auth`.
- `database` can be a Prisma client (auto-adapted) or a pre-built better-auth adapter.
