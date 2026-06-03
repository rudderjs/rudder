---
"@rudderjs/orm": minor
"@rudderjs/contracts": minor
---

Read/write split + sticky reads on the native engine (multi-connection PR3).

A native connection can declare read replicas in `config/database.ts` — `read: { url: string | string[] }` (round-robin per query), optional `write: { url }` (defaults to `url`), and `sticky: true` for read-your-writes: after a write within the current request scope, reads on that connection route to the writer. Routing rules (Laravel parity): un-locked SELECT terminals + `selectRaw`/`DB.select` → read pool; writes, DDL, locked selects (`lockForUpdate`/`sharedLock`), and **everything inside a transaction** → write connection. The sticky request scope is entered by a middleware the native provider auto-installs on the `web` + `api` groups when a sticky split connection is configured; outside a request scope (jobs, commands) sticky is a no-op and reads go to replicas — wrap with `runWithDatabaseContext()` from the new node-only `@rudderjs/orm/sticky` subpath for read-your-writes there. Query events (`DB.listen`/`onQuery`) now carry the **connection name** (config name when known, driver name otherwise) and — on split connections only — a `target: 'read' | 'write'` field (`QueryEvent.target`, new optional contract field). The dev-HMR driver cache includes the replica list in its signature and `disconnect()` closes replica drivers too.
