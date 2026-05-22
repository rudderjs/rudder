---
'@rudderjs/core': minor
'@rudderjs/router': minor
'@rudderjs/cli': patch
---

Introspection commands: `event:list`, `config:show`, `route:list --verbose`

Three small commands that close debugging loops you'd otherwise solve with
grep + restart. Plan: `docs/plans/2026-05-23-introspection-commands.md`.

**`pnpm rudder event:list`** — registered events with each listener's class
name. Wildcard (`*`) listeners surface as their own row; anonymous
inline handlers render as `<anonymous>`. Flags: `--filter <substring>`,
`--json`. Backed by a new `EventDispatcher.inspect()` method (additive
alongside the existing `list()` count-only method).

**`pnpm rudder config:show [section[.key]]`** — resolved configuration tree
with sensitive-value redaction. Keys whose final token is one of
`key, secret, password, token, dsn, webhook, signing, salt, pepper,
credentials` (camelCase / snake_case / dotted all handled) print as
`***`. `--raw` opts out with a stderr warning. `--json` round-trips
through the redaction pass; pass `--raw --json` for unredacted output.
No-arg form prints a section summary (section → key count).

**`pnpm rudder route:list --verbose`** — extends the existing command with
the resolved `[global → group → route]` middleware stack matching the
request-time composition order. Backed by a new
`RudderJS.middlewareSnapshot()` method that combines the user's
`withMiddleware()` block with provider-registered group middleware
(`appendToGroup()` calls during `boot()`). `--verbose --json` emits a
`resolved: { global, group, route }` triple per api route. Default
output unchanged. Also accepts `-v` as a short alias.

All three commands are loaded via the cli's `tryImport` mechanism — no
changes for users who don't invoke them. `Router.list()` output now
includes the route's `group` tag (additive `group?: 'web' | 'api'`),
already declared in `@rudderjs/contracts` and previously inert.
