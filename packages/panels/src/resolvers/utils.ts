import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { ResolveSchemaFn } from './types.js'
import { debugWarn } from '../debug.js'

// ─── Child panel factory ─────────────────────────────────────

/**
 * Create a child panel that delegates to the parent but overrides `getSchema`.
 * Used by resolvers that need to recursively resolve inner schema elements
 * (Section, Dialog, Tabs, Widget, Dashboard).
 */
export function createChildPanel(panel: Panel, items: unknown[]): Panel {
  return Object.create(panel, {
    getSchema: { value: () => items },
  }) as Panel
}

/**
 * Resolve inner schema elements by creating a child panel and delegating.
 */
export async function resolveChildSchema(
  panel: Panel,
  ctx: PanelContext,
  items: unknown[],
  resolveSchema: ResolveSchemaFn,
): Promise<PanelSchemaElementMeta[]> {
  const child = createChildPanel(panel, items)
  return resolveSchema(child, ctx)
}

// ─── Lazy data resolution ────────────────────────────────────

/** Options for resolving async data functions with lazy/poll support. */
interface ResolveDataFnOptions<T> {
  /** The async data function to call (may be undefined). */
  dataFn: ((ctx: PanelContext) => Promise<T>) | undefined
  /** Whether this element is lazy-loaded (skip SSR data fetch). */
  isLazy: boolean
  /** Debug context label for error logging. */
  debugLabel: string
}

/**
 * Resolve an async data function with lazy/poll guard.
 * - If `dataFn` exists and element is not lazy, calls it and returns the result.
 * - If element is lazy, returns `undefined` (caller should set empty defaults).
 * - On error, logs via `debugWarn` and returns `undefined`.
 */
export async function resolveDataFn<T>(
  ctx: PanelContext,
  opts: ResolveDataFnOptions<T>,
): Promise<T | undefined> {
  if (opts.dataFn && !opts.isLazy) {
    try {
      return await opts.dataFn(ctx)
    } catch (e) {
      debugWarn(opts.debugLabel, e)
    }
  }
  return undefined
}

// ─── Lazy/poll/live metadata ─────────────────────────────────

interface LazyPollSource {
  isLazy?(): boolean
  getPollInterval?(): number | undefined
  isLive?(): boolean
}

/**
 * Apply lazy, pollInterval, and live flags to a meta object.
 * Mutates the target in-place and returns it for chaining.
 */
export function applyLazyMeta(
  meta: Record<string, unknown>,
  source: LazyPollSource,
): void {
  if (source.isLazy?.())                        meta['lazy']         = true
  if (source.getPollInterval?.() !== undefined)  meta['pollInterval'] = source.getPollInterval()!
  if (source.isLive?.())                        meta['live']         = true
}
