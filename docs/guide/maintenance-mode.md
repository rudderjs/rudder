# Maintenance Mode

When you deploy a release, run a long migration, or need to take the app offline for a moment, put it into **maintenance mode**. Every request is short-circuited with a `503 Service Unavailable` until you bring it back up — with an escape hatch for yourself and any health-check endpoints you nominate.

This is Rudder's equivalent of Laravel's `artisan down` / `artisan up`.

## Taking the app down

```bash
pnpm rudder down
```

That's it — the app now returns `503` to every visitor. Bring it back with:

```bash
pnpm rudder up
```

Both commands are **skip-boot**: they don't start the application (writing a flag file needs no app context — and the app may well be down precisely because it can't boot). They write and remove a JSON flag file at `storage/framework/down`; the kernel checks for it on every request.

## `rudder down` options

| Option | Description |
|---|---|
| `--secret <token>` | Bypass token. Visit any URL with `?secret=<token>` once to set a bypass cookie and browse the app normally while it's down. |
| `--retry <seconds>` | Value for the `Retry-After` response header. Tells well-behaved clients and crawlers when to come back. |
| `--message <text>` | Message shown in the `503` response body. Defaults to `"Service Unavailable"`. |
| `--allow <paths>` | Comma-separated paths always let through — e.g. health checks. Each entry supports a trailing `*` wildcard. |

```bash
pnpm rudder down \
  --message "Upgrading the database — back in a few minutes" \
  --retry 120 \
  --secret "let-me-in-9f3a" \
  --allow "/health,/status,/webhooks/*"
```

While down, this configuration:

- returns `503` with `{ "message": "Upgrading the database — back in a few minutes" }`,
- sets `Retry-After: 120` on every `503`,
- lets `/health`, `/status`, and anything under `/webhooks/` through untouched,
- lets *you* through if you visit any URL with `?secret=let-me-in-9f3a`.

## Bypassing maintenance mode

Pass `--secret` when taking the app down, then hit any URL with that token in the query string:

```
https://example.com/?secret=let-me-in-9f3a
```

The first such request sets an `HttpOnly`, `SameSite=Strict` cookie (`rudder_maintenance_bypass`), so every subsequent request from that browser passes through normally — no need to keep the query string. The rest of the world still sees the `503`.

## What's always let through

Even with no `--allow` list, the maintenance middleware never gates:

- **Vite internals and static assets** — paths starting with `/@` or whose last segment contains a dot (`/app.css`, `/@vite/client`). This keeps the dev overlay and HMR socket alive if you run `rudder down` during local development.
- **Allow-listed paths** — the union of `--allow` and any `except` paths configured on the middleware.
- **Bypass requests** — a valid `?secret=` query param or the bypass cookie.

## How it works

A JSON flag file at `storage/framework/down` is the single source of truth:

```json
{
  "time": 1717953383000,
  "message": "Upgrading the database — back in a few minutes",
  "retry": 120,
  "secret": "let-me-in-9f3a",
  "allow": ["/health", "/status", "/webhooks/*"]
}
```

The kernel auto-installs `maintenanceMiddleware` **first** in the request pipeline — before any of your global or group middleware. When the app is up it's a pure `existsSync` no-op, so there's no measurable cost to leaving it in place. When the file exists, it short-circuits the request as described above. There's nothing to register; it's wired automatically.

### Programmatic access

The same primitives are exported from `@rudderjs/core` (Node-only) if you need them in a script or a custom command:

```ts
import {
  down,
  up,
  isDownForMaintenance,
  maintenanceData,
} from '@rudderjs/core'

down({ time: Date.now(), message: 'Scheduled maintenance', retry: 300 })
isDownForMaintenance()   // → true
maintenanceData()        // → { time, message, retry, ... } | null
up()                     // → true if it was down, false if already up
```

## Scheduled tasks during maintenance

By default the [task scheduler](/guide/scheduling) **skips** every task while the app is down — both `schedule:run` and the `schedule:work` daemon honor the flag file. A task that must keep running regardless (a heartbeat, a critical cleanup) opts back in with `evenInMaintenanceMode()`:

```ts
schedule
  .call(sendHeartbeat)
  .everyFiveMinutes()
  .evenInMaintenanceMode()   // runs even while `rudder down`
  .description('External heartbeat')
```

See [Task Scheduling](/guide/scheduling) for the full set of schedule hooks.
