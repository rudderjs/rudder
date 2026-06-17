---
"@rudderjs/auth": minor
---

Add `loginUsingId`, `once`, and `onceUsingId` to `Guard`, `SessionGuard`, `AuthManager`, and `Auth` facade.

- `loginUsingId(id, remember?)` - look up a user by primary key and log them in
- `once(credentials)` - validate credentials and authenticate for this request only (no session write)
- `onceUsingId(id)` - look up by primary key and authenticate for this request only (no session write)
