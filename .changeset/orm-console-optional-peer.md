---
"@rudderjs/orm": patch
---

Decouple `@rudderjs/orm` from `@rudderjs/console` for standalone (any-Node-app) use.

`@rudderjs/console` was a hard `dependency`, so `npm i @rudderjs/orm` dragged the CLI/`@clack` graph into every install — even a plain Node project that only uses `Model` + the native engine and never touches the framework CLI. It's now an **optional peer** (matching `@rudderjs/core` and `better-sqlite3`).

The Model layer, the `@rudderjs/orm/native` engine, and `./commands/prune` never imported it; only the framework-CLI subpaths do (`./doctor`, `./commands/migrate` at runtime; `./commands/make-factory` / `./commands/make-seeder` are type-only). Those subpaths only ever load inside a Rudder app, where `@rudderjs/console` is already present via `@rudderjs/cli` / `@rudderjs/core` — so **Rudder apps are unaffected**. Standalone installs now get a leaner dependency graph with no CLI tooling pulled in.
