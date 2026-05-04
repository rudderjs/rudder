# `@rudderjs/orm` — `Prunable` + `MassPrunable` + `model:prune`

**Status:** PROPOSED — design + implementation contract.
**Author handoff:** filed for the next rudder agent. Self-contained.
**Scope:** v1 = duck-typed `Prunable` / `MassPrunable` markers + `model:prune` CLI command + scheduler integration.

---

## Why

Apps accumulate stale rows: expired sessions, soft-deleted records past retention, orphaned uploads, audit logs older than N days. Today users hand-roll a delete loop; every app reinvents chunking, observer firing, and dry-run support. Laravel ships `Prunable` + `MassPrunable` — we already have `ModelRegistry.all()` so discovery is free. **Unlock:** `scheduler.command('model:prune').daily()` becomes a first-class retention hook with zero per-model wiring.

---

## Scope (v1)

| Surface | What it does |
|---|---|
| `Prunable` | Per-instance pruning. Hydrates each row, fires observers + optional `pruning(model)` hook, deletes one at a time (chunked). |
| `MassPrunable` | Bulk pruning. Skips hydration, runs a single `deleteAll()` per chunk. No observers, no `pruning()` hook. |
| `pnpm rudder model:prune` | Walks `ModelRegistry`, prunes every model implementing either marker. |
| `--model=A,B`, `--except=A`, `--chunk=N`, `--pretend` | Filter + chunk-size + dry-run flags. |
| Scheduler | `scheduler.command('model:prune').daily()` already works — no schedule changes. |

**Out of scope (v1):** cross-database / multi-shard pruning (project-wide OOS), `--profile` timing flag, queue-backed prune fan-out, streaming `pruning` over an event bus (use `Model.observe(...)`), resume-on-crash (prune is idempotent — re-run).

---

## Design

### 1. The two interfaces

In `packages/orm/src/index.ts`, near the `ModelObserver` block (around line 114):

```ts
import type { QueryBuilder } from '@rudderjs/contracts'

/**
 * Models implementing `Prunable` are eligible for `pnpm rudder model:prune`.
 * Each matching record is hydrated, the optional `pruning()` hook fires,
 * then the standard `deleting`/`deleted` observers run and the record is
 * removed via `instance.delete()` (so soft-deletes are honored).
 *
 * Use when you need observer hooks, per-row reactions, or cleanup side
 * effects (S3 delete, search-index removal). For high-volume retention with
 * no per-row work, prefer {@link MassPrunable}.
 */
export interface Prunable {
  /** Records to prune. Called once per chunk; runner re-issues to dodge
   *  shifting offsets. Index your filter columns. */
  prunable(): QueryBuilder<unknown>
  /** Optional pre-delete hook. Throwing skips this row; runner continues. */
  pruning?(model: Model): void | Promise<void>
}

/**
 * Bulk-pruned via a single `deleteAll()` per chunk. Faster than
 * {@link Prunable}, but observers do NOT fire, `pruning()` is NOT called,
 * and `softDeletes` is NOT applied (mirrors Laravel; `deleteAll()` is the
 * existing bulk DELETE primitive). Use for append-only retention
 * (analytics events, expired tokens, job-batch records).
 */
export interface MassPrunable {
  prunable(): QueryBuilder<unknown>
}
```

### 2. How a model declares it — duck-typed + static marker

TS interfaces are erased; runtime can't `instanceof Prunable`. Strategy mix:

- **Discovery** = duck-type on `static prunable()` existence (absence = not prunable).
- **Disambiguation** = `static pruneMode: 'instance' | 'mass'` (default `'instance'` — safer / observer-firing).

```ts
// Per-instance — observers fire
class Session extends Model implements Prunable {
  static prunable() { return this.where('expiresAt', '<', new Date()) }
  static pruning(s: Session) { /* optional pre-delete hook */ }
}

// Bulk — no observers, no pruning() hook
class FailedJob extends Model implements MassPrunable {
  static override pruneMode: 'mass' = 'mass'
  static prunable() { return this.where('failedAt', '<', daysAgo(7)) }
}
```

Add to `Model`'s static surface (around line 364, alongside `morphAlias`):

```ts
/** Pruning mode for `pnpm rudder model:prune`. Override to `'mass'` for
 *  {@link MassPrunable}. Runner only considers models that also define
 *  `static prunable()`. */
static pruneMode: 'instance' | 'mass' = 'instance'
```

### 3. Runner — `pruneModels()`

New file `packages/orm/src/prune.ts` so the command stays a thin shell:

```ts
import { Model, ModelRegistry } from './index.js'
import type { QueryBuilder } from '@rudderjs/contracts'

export interface PruneOptions { models?: string[]; except?: string[]; chunk?: number; pretend?: boolean }
export interface PruneReport  { model: string; mode: 'instance' | 'mass'; count: number }

type PrunableClass = typeof Model & {
  prunable(): QueryBuilder<unknown>
  pruning?(model: Model): void | Promise<void>
  pruneMode: 'instance' | 'mass'
}

const isPrunable = (C: typeof Model): C is PrunableClass =>
  typeof (C as { prunable?: unknown }).prunable === 'function'

export async function pruneModels(opts: PruneOptions = {}): Promise<PruneReport[]> {
  const chunk   = opts.chunk ?? 1000
  const include = opts.models ? new Set(opts.models) : null
  const exclude = new Set(opts.except ?? [])
  const reports: PruneReport[] = []

  for (const [name, ModelClass] of ModelRegistry.all()) {
    if (include && !include.has(name)) continue
    if (exclude.has(name) || !isPrunable(ModelClass)) continue

    const mode = ModelClass.pruneMode
    let count = 0

    if (opts.pretend) {
      count = await ModelClass.prunable().count()
    } else if (mode === 'mass') {
      // limit() works for Prisma (deleteMany take) + Drizzle (delete.limit)
      let deleted = chunk
      while (deleted === chunk) {
        deleted = await ModelClass.prunable().limit(chunk).deleteAll()
        count  += deleted
      }
    } else {
      // 'instance' — re-query per chunk because deletes shift the offset
      let page = await ModelClass.prunable().limit(chunk).get() as Model[]
      while (page.length > 0) {
        for (const row of page) {
          if (typeof ModelClass.pruning === 'function') {
            try { await ModelClass.pruning(row) }
            catch (err) {
              console.error(`[RudderJS prune] ${name} pruning() failed: ${(err as Error).message}`)
              continue
            }
          }
          await row.delete()  // routes through static delete() → observers fire
          count++
        }
        if (page.length < chunk) break
        page = await ModelClass.prunable().limit(chunk).get() as Model[]
      }
    }
    reports.push({ model: name, mode, count })
  }
  return reports
}
```

**Re-query per chunk (instead of `offset()` paging)** because deletions shift the cursor. Re-querying always returns the next batch of currently-matching rows.

### 4. CLI command — `model:prune`

New file `packages/orm/src/commands/prune.ts`:

```ts
import { pruneModels } from '../prune.js'

export function registerPruneCommand(
  rudder: { command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown } },
): void {
  rudder.command('model:prune', async (args: string[]) => {
    const opts = {
      models:  arg(args, '--model')?.split(',').map(s => s.trim()).filter(Boolean),
      except:  arg(args, '--except')?.split(',').map(s => s.trim()).filter(Boolean),
      chunk:   arg(args, '--chunk') ? Number(arg(args, '--chunk')) : undefined,
      pretend: args.includes('--pretend'),
    }
    const reports = await pruneModels(opts)
    if (reports.length === 0) { console.log('  No prunable models registered.'); return }
    const verb = opts.pretend ? 'Would prune' : 'Pruned'
    for (const r of reports) console.log(`  ${verb} ${r.count.toLocaleString()} ${r.model} (${r.mode})`)
    const total = reports.reduce((n, r) => n + r.count, 0)
    console.log(`  ${verb.toLowerCase()} ${total.toLocaleString()} record(s) across ${reports.length} model(s).`)
  }).description('Prune records from models implementing Prunable / MassPrunable')
}

function arg(args: string[], name: string): string | undefined {
  const eq = args.find(a => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : undefined
}
```

Tiny arg parser by design — matches `migrate.ts` style. No `parseSignature()` because `model:prune` has no positional args.

### 5. CLI loader entry — required per CLAUDE.md

`@rudderjs/cli`'s `loadPackageCommands()` (`packages/cli/src/index.ts:123`) eagerly imports known subpaths. **A new package command is invisible to the CLI until you add a loader entry.** Add alongside the existing orm migrate loader:

```ts
// In loadPackageCommands(), add a new loader:
async () => {
  const mod = await tryImport('@rudderjs/orm', 'commands/prune')
  const register = mod['registerPruneCommand'] as (r: typeof rudder) => void
  register(rudder)
},
```

Add the subpath export to `packages/orm/package.json`:

```json
"./commands/prune": {
  "import": "./dist/commands/prune.js",
  "types": "./dist/commands/prune.d.ts"
}
```

### 6. Scheduling — already works

Once registered, the schedule package handles it with no changes:

```ts
// routes/console.ts
scheduler.command('model:prune').daily()
scheduler.command('model:prune --pretend').weeklyOn(0, '09:00')   // dry-run report
```

Show this in the README + the `model:prune` description hint.

---

## Implementation tasks

Each task is independently committable.

### Task 1 — Interfaces + `pruneMode` static
- Add `Prunable` + `MassPrunable` interfaces to `packages/orm/src/index.ts` exports.
- Add `static pruneMode` to `Model`.
- Build + typecheck. No behavior change.

### Task 2 — `pruneModels()` runner
- New file `packages/orm/src/prune.ts` — implementation per Design § 3.
- Export `pruneModels` + `PruneReport` + `PruneOptions` from `index.ts` (so apps can call it programmatically too).

### Task 3 — `model:prune` command
- New file `packages/orm/src/commands/prune.ts` per Design § 4.
- Add `./commands/prune` subpath to `packages/orm/package.json#exports`.
- Add the loader entry in `packages/cli/src/index.ts` per Design § 5.

### Task 4 — Tests

`packages/orm/src/prune.test.ts` (sibling of `index.test.ts`, reuse its `makeQb()` / `makeAdapter()` helpers from lines 7-44):

| Scenario | Assert |
|---|---|
| Model without `prunable()` skipped | Not in report. |
| `Prunable` 5 rows, chunk=2 | Three queries (2+2+1); 5 `delete()` calls. |
| `pruning()` hook fires per row | Call count = row count. |
| `pruning()` throws → skip row, continue | Count = N − failures; error logged. |
| `MassPrunable` uses `deleteAll()` | Adapter sees `deleteAll`, never `get`. |
| `MassPrunable` 2500 rows, chunk=1000 | Three `deleteAll()` calls (1000, 1000, 500). |
| `--pretend` runs `count()` only | No `delete` / `deleteAll`. |
| `--model=Foo,Bar` / `--except=Foo` / `--chunk=50` | Filters + chunk size flow through. |
| Empty registry | Returns `[]`; CLI prints "No prunable models". |
| `Prunable` fires `deleting`/`deleted` observers | Spy via `Model.observe(...)`. |
| `MassPrunable` does NOT fire observers | Negative assertion. |

Add `dist-test/prune.test.js` + `dist-test/commands/prune.test.js` to the `test` script in `packages/orm/package.json`.

### Task 5 — README + CLAUDE.md + CHANGELOG
- `packages/orm/README.md` — new "Pruning" section after "Soft deletes". Show `Prunable` example, `MassPrunable` example, scheduler call.
- `packages/orm/CLAUDE.md` Architecture Rules — add a bullet under "Soft deletes":
  > **Pruning**: Models implementing `Prunable` (per-row + observers) or `MassPrunable` (bulk DELETE, no observers) are picked up by `pnpm rudder model:prune`. `pruneMode` static (default `'instance'`) disambiguates. Discovery uses `ModelRegistry.all()`. `MassPrunable` bypasses soft deletes (mirrors `deleteAll()` semantics).
- `packages/cli/CLAUDE.md` Command Ownership table — add `model:prune` to the `@rudderjs/orm` row.
- `packages/orm/CHANGELOG.md` — minor entry (additive only, no consumer migration).

### Task 6 — Cut a changeset
```bash
pnpm changeset
# minor bump for @rudderjs/orm + @rudderjs/cli (loader entry).
```

---

## What this plan deliberately doesn't do

- **No global `enabledByDefault` flag.** A model is prunable iff it defines `static prunable()`. App-level kill switch = `--except` or drop `model:prune` from the schedule.
- **No new `ModelEvent` for pruning.** `Prunable.pruning(model)` is a static class hook (Laravel parity). Standard `deleting`/`deleted` observers still fire via `instance.delete()` — that's the "react to any delete" hook. `pruning()` is "react only to a prune-triggered delete."
- **No `restore` integration.** Soft-deleted rows can be `Prunable` (`this.onlyTrashed().where('deletedAt', '<', cutoff)`) — canonical retention pattern.
- **No streaming progress to telescope.** Telescope's existing model-event collector covers `Prunable` via the standard delete chain. `MassPrunable` is intentionally invisible (Laravel parity).
- **No `--queue` flag.** Apps needing queue-backed prune dispatch their own job; runner is sync by design (matches the `migrate` family).
- **No type-level static enforcement.** TS can't enforce static members through `implements` cleanly — rely on duck-typing + `static prunable()` declaration. `implements Prunable` is for human readers.

---

## Open questions for the implementer

1. **`MassPrunable` + `softDeletes`** — `deleteAll()` bypasses soft deletes (matches Laravel + the "mass" intent). Worth a docstring callout. Soft-delete-aware bulk pruning → use `Prunable` (per-row `delete()` honors `softDeletes`).
2. **Re-query cost on huge tables** — document "index the columns your `prunable()` filter touches" (mirrors the `paginate()` advice in README).
3. **`prunable()` returns `withTrashed()` on a soft-delete model** — passes through; `instance.delete()` no-ops on already-trashed rows. Add a test asserting no double-delete.
4. **`pruning()` throw behavior** — log + continue. Alternative (abort entire run) hides cleanup behind one bad row. Stick with continue; document loudly.

---

## File touch list (final)

- `packages/orm/src/index.ts` — `Prunable` + `MassPrunable` interfaces + `static pruneMode` + re-export of `pruneModels`
- `packages/orm/src/prune.ts` — new
- `packages/orm/src/commands/prune.ts` — new
- `packages/orm/src/prune.test.ts` — new
- `packages/orm/src/commands/prune.test.ts` — new (tiny — arg parsing + report formatting)
- `packages/orm/package.json` — new `./commands/prune` subpath export + extended test script
- `packages/cli/src/index.ts` — new loader entry in `loadPackageCommands()`
- `packages/orm/README.md` — Pruning section
- `packages/orm/CHANGELOG.md` — minor entry
- `packages/orm/CLAUDE.md` — bullet under Architecture Rules
- `packages/cli/CLAUDE.md` — Command Ownership table row update
- `.changeset/<random>.md` — generated by `pnpm changeset`

Estimated: half a day for impl + tests + docs. Runner is mechanical; arg parsing matches `migrate.ts`; tests reuse existing `makeQb()` mock infra.
