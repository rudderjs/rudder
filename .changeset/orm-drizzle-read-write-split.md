---
'@rudderjs/orm-drizzle': minor
---

Real read/write splitting + sticky reads on the Drizzle adapter. `read` / `write` / `sticky` connection config (same shape as the native engine) now routes un-locked SELECT terminals and raw `DB.select` to a round-robin read pool — replica clients are opened per `readUrls` through the same lazy driver path as the write client — while writes, DDL, locked selects, and every transaction statement stay on the write connection. Sticky reads share the `@rudderjs/orm/sticky` request scope (the provider auto-installs the database-context middleware on the `web` + `api` groups), query events carry `target: 'read' | 'write'` on split connections plus the connection name (`connectionName ?? dialect`), the dev-HMR client cache holds the replica clients (replica list is part of the signature), and `disconnect()` closes them. Replaces the former boot-time throw for `read:` / `write:` config on Drizzle connections.
