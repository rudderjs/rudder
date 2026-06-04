---
"@rudderjs/orm-prisma": patch
---

Fix nested transactions (SAVEPOINT) failing on MySQL: the mariadb driver adapter now uses the text protocol. MySQL cannot prepare SAVEPOINT / ROLLBACK TO SAVEPOINT / RELEASE SAVEPOINT (error 1295), and the adapter's nested `transaction()` support emits those through `$executeRawUnsafe`, which the default binary protocol routes through a prepared statement — so every nested transaction on a `make()`-constructed mysql connection failed. If you pass your own PrismaClient on mysql, construct its `PrismaMariaDb` adapter with `{ useTextProtocol: true }`.
