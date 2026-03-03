# @boostkit/auth

Shared authentication result and entity types.

## Installation

```bash
pnpm add @boostkit/auth
```

## Usage

```ts
import type { AuthUser, AuthSession, AuthResult } from '@boostkit/auth'

const user: AuthUser = {
  id: '1',
  name: 'A',
  email: 'a@example.com',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
}
```

## API Reference

- `AuthUser`
- `AuthSession`
- `AuthResult`

## Configuration

This package has no runtime config object.

## Notes

- This package exports types/interfaces only.
