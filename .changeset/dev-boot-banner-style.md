---
"@rudderjs/core": minor
"@rudderjs/vite": minor
---

Harmonize the dev startup output with Vike's banner.

- `@rudderjs/vite` now splices `· Rudder vX.Y.Z` (name bold, in Rudder's brand
  orange) into Vike's startup line (`Vike v… · Vite v… · Rudder v1.5.1 · ready in
  N ms`), reading the installed `@rudderjs/core` version. Falls back to printing
  its own line if Vike's banner format changes, so the version is never lost.
  Dev-only.
- `@rudderjs/core`'s dev boot log is rendered as Vite-style `➜` lines that sit
  with `➜ Local`/`➜ Network` instead of the `├─└─` tree — `➜ Auto-discovered N
  providers`, one aligned `➜ <stage>: …` line per stage, and `➜ App is ready`.
  Production keeps the parseable `[RudderJS] ready` prefix.
- New `bootLine(message)` export from `@rudderjs/core` — print a `➜`-styled line
  from a provider's `boot()` so app/provider startup logs match the framework's
  banner. Plain (no arrow/ANSI) in production.
