import type { ProviderEntry, ProviderStage } from './provider-registry.js'

/**
 * Sort provider entries by stage, then topologically by `depends`.
 *
 * Within each stage, dependencies come before dependents. Cross-stage
 * dependencies are tolerated (a feature can depend on infrastructure)
 * because the stage order already enforces that ordering.
 *
 * Throws on circular dependencies with a clear message naming the cycle.
 */
export function sortByStageAndDepends(entries: ProviderEntry[]): ProviderEntry[] {
  const byPackage = new Map<string, ProviderEntry>()
  for (const entry of entries) byPackage.set(entry.package, entry)

  // Group by stage
  const stages = new Map<ProviderStage, ProviderEntry[]>()
  for (const entry of entries) {
    const list = stages.get(entry.stage) ?? []
    list.push(entry)
    stages.set(entry.stage, list)
  }

  const result: ProviderEntry[] = []

  // Walk stages in order, topo-sort within each
  const orderedStages: ProviderStage[] = ['foundation', 'infrastructure', 'feature', 'monitoring']
  for (const stage of orderedStages) {
    const group = stages.get(stage)
    if (!group) continue
    result.push(...topoSort(group, byPackage))
  }

  return result
}

function topoSort(entries: ProviderEntry[], all: Map<string, ProviderEntry>): ProviderEntry[] {
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const out: ProviderEntry[] = []

  function visit(entry: ProviderEntry, path: string[]): void {
    if (visited.has(entry.package)) return
    if (visiting.has(entry.package)) {
      const cycle = [...path, entry.package].join(' → ')
      throw new Error(`[RudderJS] Circular provider dependency: ${cycle}`)
    }
    visiting.add(entry.package)
    for (const dep of entry.depends ?? []) {
      const depEntry = all.get(dep)
      // Only follow dependencies within the same stage during topo sort.
      // Cross-stage deps are handled by the stage ordering itself.
      if (depEntry && depEntry.stage === entry.stage) {
        visit(depEntry, [...path, entry.package])
      }
    }
    visiting.delete(entry.package)
    visited.add(entry.package)
    out.push(entry)
  }

  for (const entry of entries) visit(entry, [])
  return out
}
