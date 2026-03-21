import { createRegistry } from './BaseRegistry.js'

interface ComputeEntry {
  from: string[]
  compute: (values: Record<string, unknown>) => unknown
}

/** @internal — stores Field compute functions for server-side recomputation. */
export const ComputeRegistry = createRegistry<ComputeEntry>()
