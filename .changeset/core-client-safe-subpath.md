---
"@rudderjs/core": minor
---

Add a client-safe `@rudderjs/core/client` subpath. The main `@rudderjs/core` entry re-exports `@rudderjs/console` (whose `@clack/*` dependency statically imports `node:process`/`node:fs`) plus a few Node-only modules, so it crashes when bundled into the browser (`process is not defined`). Code reachable from both server and client — shared service classes, form requests, config/env access, DI — should import `app`, `Env`, `env`, `config`, `Container`, validation, exceptions, etc. from `@rudderjs/core/client`, which omits the console re-export and every Node-only module and is verified to evaluate in a browser by a new CI client-bundle smoke gate. The main `.` entry is unchanged (no breaking change).
