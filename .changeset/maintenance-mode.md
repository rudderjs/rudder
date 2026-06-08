---
"@rudderjs/core": minor
"@rudderjs/cli": minor
"@rudderjs/schedule": minor
---

Add maintenance mode — `rudder down` / `rudder up` (Laravel parity).

`@rudderjs/schedule` already had `evenInMaintenanceMode()` on tasks, but nothing ever checked app maintenance state, so the flag was dead. This wires up the missing piece end to end:

- **`@rudderjs/core`** gains node-only helpers (`isDownForMaintenance`, `maintenanceData`, `down`, `up`) backed by a JSON flag file at `storage/framework/down` (fields: `time`, `message`, `retry`, `secret`, `allow`), plus a kernel `maintenanceMiddleware()`. The middleware is auto-installed first in the request pipeline (a pure `existsSync` no-op when the app is up) and returns `503` with a `Retry-After` header while down — except requests matching the allow-list or carrying the bypass secret (`?secret=<token>` sets a bypass cookie). All exported from the main entry only, never `@rudderjs/core/client` (it statically imports `node:fs`); `app-builder` reaches it via a lazy server-only import, so the client bundle stays clean.
- **`@rudderjs/cli`** adds the skip-boot `down` (`--secret`, `--retry`, `--message`, `--allow`) and `up` commands.
- **`@rudderjs/schedule`** now skips due tasks while down unless they're flagged `evenInMaintenanceMode()`, in both `schedule:run` and `schedule:work`.
