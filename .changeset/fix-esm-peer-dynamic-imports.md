---
"@rudderjs/mail": patch
"@rudderjs/notification": patch
---

Fix ESM-only peer loading in three runtime sites that used synchronous `require()` against `@rudderjs/queue` and `@rudderjs/broadcast`. Because those peers' `exports` field has no `require` condition, `Mail.to(...).queue(...)`, queued notifications via `Notifier.send(...)`, and `BroadcastChannel.send` all threw "No exports main defined" — masked as the generic peer-missing error — even when the peer was installed.

Switched all three sites to `await import(...)` (shipped in #448, changeset added retroactively).
