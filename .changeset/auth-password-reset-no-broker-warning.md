---
"@rudderjs/auth": patch
---

Warn in development when `requestPasswordReset` is called on a `BaseAuthController` subclass that has no `passwordBroker` configured. Previously the handler returned `{ status: 'sent' }` with no signal, so a developer who forgot to wire `this.passwordBroker` saw the forgot-password form succeed and only discovered the gap when users reported missing reset emails.

The production path is unchanged — it keeps the constant, enumeration-safe `200` with no log — so the warning never becomes a registration oracle.
