# @forge/auth

Shared authentication types for Forge applications.

## Installation

```bash
pnpm add @forge/auth
```

## Usage

```ts
import type { AuthUser, AuthSession, AuthResult } from '@forge/auth'
```

## Interfaces

### `AuthUser`

Represents an authenticated user.

```ts
interface AuthUser {
  id: string
  name?: string
  email: string
  emailVerified: boolean
  image?: string
  createdAt: Date
  updatedAt: Date
}
```

| Field           | Type      | Description                              |
|-----------------|-----------|------------------------------------------|
| `id`            | `string`  | Unique user identifier                   |
| `name`          | `string?` | Display name (optional)                  |
| `email`         | `string`  | User email address                       |
| `emailVerified` | `boolean` | Whether the email has been verified      |
| `image`         | `string?` | Avatar or profile image URL (optional)   |
| `createdAt`     | `Date`    | Timestamp when the user was created      |
| `updatedAt`     | `Date`    | Timestamp when the user was last updated |

### `AuthSession`

Represents an active authentication session.

```ts
interface AuthSession {
  id: string
  userId: string
  token: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}
```

| Field       | Type     | Description                                |
|-------------|----------|--------------------------------------------|
| `id`        | `string` | Unique session identifier                  |
| `userId`    | `string` | ID of the user this session belongs to     |
| `token`     | `string` | Session token (used for authentication)    |
| `expiresAt` | `Date`   | When the session expires                   |
| `createdAt` | `Date`   | Timestamp when the session was created     |
| `updatedAt` | `Date`   | Timestamp when the session was last updated |

### `AuthResult`

Returned after a successful authentication operation — contains both the user and their active session.

```ts
interface AuthResult {
  user: AuthUser
  session: AuthSession
}
```

## Notes

- `@forge/auth` contains **types and interfaces only** — there is no runtime code.
- It is used by `@forge/auth-better-auth` as the shared contract between auth adapters and application code.
- When building a custom auth provider, implement your resolved user/session data against these interfaces to stay compatible with the Forge auth ecosystem.
