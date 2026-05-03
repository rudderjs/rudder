---
"create-rudder-app": patch
---

test: smoke profile for ORM=none + observability + utility packages (Phase 6)

Adds a `no-db` smoke profile that scaffolds with ORM=none and every
package that survives the multiselect's DB filter — telescope, pulse,
horizon, queue, mail, notifications, storage, scheduler, image,
localization, pennant, crypt, http, process, concurrency. All 36
generated files boot through `rudder command:list` cleanly.

The Phase 6 plan called for switching telescope/pulse to memory storage
when ORM=none. Verified the configs already default to `'memory'`
(updated during prior phases), and horizon already branches to memory
when `QUEUE_CONNECTION=sync`. The remaining gap was the absence of
smoke coverage to lock that behavior in. Now any future change that
re-introduces a Prisma dependency in observability boot paths fails
CI immediately.

Run with:

```bash
pnpm --filter create-rudder-app smoke --profile=no-db
```
