---
"@rudderjs/cli": patch
---

One-shot `rudder` commands no longer hang on a native pg/mysql connection. The pooled drivers (`postgres` / `mysql2`) hold sockets that keep the event loop alive after a command's handler resolves, so `rudder migrate` (and any command booting an app whose default connection is native pg/mysql) never exited — sqlite was unaffected because better-sqlite3 is synchronous. The CLI now closes every cached native driver after the command completes; long-running commands (`queue:work`, `schedule:work`) are unaffected since they only reach the exit path on shutdown.
