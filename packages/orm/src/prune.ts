import type { QueryBuilder } from '@rudderjs/contracts'
import { Model, ModelRegistry } from './index.js'

export interface PruneOptions {
  models?:  string[]
  except?:  string[]
  chunk?:   number
  pretend?: boolean
}

export interface PruneReport {
  model: string
  mode:  'instance' | 'mass'
  count: number
}

type PrunableClass = typeof Model & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prunable():     QueryBuilder<any>
  pruning?(model: Model): void | Promise<void>
  pruneMode:      'instance' | 'mass'
}

const isPrunable = (C: typeof Model): C is PrunableClass =>
  typeof (C as { prunable?: unknown }).prunable === 'function'

/**
 * Walk the {@link ModelRegistry}, prune every model implementing
 * `Prunable` / `MassPrunable`. Returns one report per pruned model.
 *
 * - `instance` mode: hydrates each row, fires the optional static
 *   `pruning(model)` hook, then `await row.delete()` (so soft-deletes
 *   and observers fire). Re-queries per chunk because deletes shift
 *   the offset.
 * - `mass` mode: bulk `deleteAll()` per chunk; no hydration, no hooks,
 *   no observers, no soft-delete handling (mirrors Laravel + the
 *   existing bulk-delete primitive).
 *
 * `pretend` mode runs `count()` only — no rows are touched.
 */
export async function pruneModels(opts: PruneOptions = {}): Promise<PruneReport[]> {
  const chunk   = opts.chunk ?? 1000
  const include = opts.models ? new Set(opts.models) : null
  const exclude = new Set(opts.except ?? [])
  const reports: PruneReport[] = []

  for (const [name, ModelClass] of ModelRegistry.all()) {
    if (include && !include.has(name)) continue
    if (exclude.has(name) || !isPrunable(ModelClass)) continue

    const mode = ModelClass.pruneMode
    let count  = 0

    if (opts.pretend) {
      count = await ModelClass.prunable().count()
    } else if (mode === 'mass') {
      let deleted = chunk
      while (deleted === chunk) {
        deleted = await ModelClass.prunable().limit(chunk).deleteAll()
        count  += deleted
      }
    } else {
      // 'instance' — re-query each pass because deletions shift the offset.
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
          await row.delete()
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
