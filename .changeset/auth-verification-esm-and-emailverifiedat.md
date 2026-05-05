---
'@rudderjs/auth': major
'create-rudder-app': patch
---

Fix two bugs in email verification (`@rudderjs/auth`):

- **Schema → interface alignment (BREAKING)**: published schemas (`schema/auth.prisma` + Drizzle PG / MySQL / SQLite) now expose a nullable `emailVerifiedAt` timestamp instead of the `emailVerified: boolean` they previously declared. The `EnsureEmailIsVerified` middleware and `MustVerifyEmail` interface have always documented `emailVerifiedAt`, so verified users would get 403s under the old schemas. Apps upgrading need to migrate the column (e.g. `ALTER TABLE user RENAME COLUMN emailVerified TO emailVerifiedAt; ALTER TABLE user ALTER COLUMN emailVerifiedAt TYPE timestamp USING (CASE WHEN emailVerifiedAt THEN now() ELSE NULL END);`) — adapt to your dialect.
- **ESM `require()` removed**: `verification.ts` previously called `require('@rudderjs/router')` and `require('node:crypto')`, which throw `ReferenceError: require is not defined` in pure ESM consumers — making `verificationUrl()` and `handleEmailVerification()` non-functional. Both are now static ESM imports. `@rudderjs/router` is already a non-optional peer of `@rudderjs/auth`, so the previous try/catch fallback was unnecessary.

`create-rudder-app`'s scaffolded Prisma + User-model templates are updated to match the new column.
