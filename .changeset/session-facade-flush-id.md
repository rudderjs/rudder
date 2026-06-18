---
"@rudderjs/session": minor
---

Forward `flush()` and `id()` on the `Session` static facade. Both already existed on `SessionInstance` but were missing from the facade, so `Session.flush()` (the standard logout-flow clear) and `Session.id()` (for audit logging, CSRF binding, WS auth where `req` is out of scope) failed to type-check. Like the other mutating/required facade methods, they throw when no session is in context.
