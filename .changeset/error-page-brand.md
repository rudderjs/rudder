---
"@rudderjs/server-hono": patch
"@rudderjs/cli": patch
---

Fix leftover "RudderJS" brand strings in user-facing output (the 2026 rebrand to "Rudder" missed these — found by dogfooding).

- `@rudderjs/server-hono` — the dev (Ignition) error page rendered `<title>… — RudderJS</title>` and a `· RudderJS <version>` line in its Copy-as-Markdown report. Both now say "Rudder".
- `@rudderjs/cli` — the `rudder` command banner read `RudderJS Framework`; now `Rudder Framework`.
