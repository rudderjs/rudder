---
'@rudderjs/orm': minor
'@rudderjs/cli': minor
---

Pruning — `Prunable` / `MassPrunable` markers + `pnpm rudder model:prune` (Laravel parity #2 plan #8).

Models declaring `static prunable()` are picked up by the new `model:prune` command. Default `pruneMode = 'instance'` re-queries each chunk and calls `instance.delete()` per row — soft-deletes apply, `deleting` / `deleted` observers fire, optional `static pruning(model)` runs first. `pruneMode = 'mass'` (`MassPrunable`) runs a single `qb.deleteAll()` per chunk — no observers, no hooks, soft-deletes bypassed (mirrors the existing bulk-delete primitive).

CLI flags: `--model=A,B`, `--except=A`, `--chunk=N`, `--pretend`. Schedule it with `scheduler.command('model:prune').daily()` — first-class retention hook with zero per-model wiring.

Programmatic entry: `pruneModels({ models?, except?, chunk?, pretend? })` returns one `{ model, mode, count }` report per pruned model. Re-queries instead of `offset()` paging because deletions shift the cursor.
