# Packages

Rudder is built as a set of small, opt-in packages. The framework core is intentionally lean — every other capability ships as its own package you install only when you need it.

Pick the packages that match what you're building. Packages don't depend on each other unless they have to, and each one auto-registers its service provider when installed via `pnpm rudder module:install`.

## First-party packages

- **[Boost](/packages/boost)** — AI developer-experience layer: MCP server, per-package coding guidelines, and skill modules for Claude Code, Cursor, Copilot, Codex, Gemini, and Windsurf.
- **[Cashier Paddle](/packages/cashier-paddle)** — Paddle billing: `Billable` mixin, subscription state machine, signed webhook receiver, checkout sessions, charges, refunds, drop-in React components.
- **[Horizon](/packages/horizon)** — Queue monitoring dashboard at `/horizon`: per-job lifecycle, per-queue throughput / wait / runtime, worker status. Memory or sqlite storage.
- **[Passport](/packages/passport)** — Full OAuth 2 server: RS256-signed JWT access tokens, refresh tokens, personal access tokens, `HasApiTokens` mixin, `RequireBearer` + `scope` middleware.
- **[Pennant](/packages/pennant)** — Feature flags: define flags once, check globally or per scope, gradual rollout via `Lottery`, route middleware, `Feature.fake()` for tests.
- **[Pulse](/packages/pulse)** — Lightweight APM dashboard at `/pulse`: pre-aggregated request / queue / cache / exception / user / server metrics with sparklines and slow-request tables. Memory or sqlite storage.
- **[Sanctum](/packages/sanctum)** — Lightweight API token auth: opaque bearer tokens with abilities, no OAuth or JWT machinery.
- **[Socialite](/packages/socialite)** — OAuth-based social login: built-in providers for GitHub, Google, Facebook, Apple, plus an extension point for custom OAuth providers.
- **[Telescope](/packages/telescope)** — Debug dashboard at `/telescope`: records 19 entry types — requests, queries, jobs, exceptions, mail, events, cache, AI runs, MCP activity, `dump()`, and more.
