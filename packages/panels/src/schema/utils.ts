/**
 * Shared utilities for schema element classes.
 */

// ─── String utilities ────────────────────────────────────────

/** Convert a string to a URL-safe slug. */
export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

/** Convert a camelCase or PascalCase name to a human-readable Title Case label. */
export function toTitleCase(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim()
}

// ─── Lazy/Poll/Live meta helpers ─────────────────────────────

interface LazyPollSource {
  isLazy(): boolean
  getPollInterval(): number | undefined
}

interface LazyPollLiveSource extends LazyPollSource {
  isLive(): boolean
}

/** Apply lazy + pollInterval meta fields to a meta object. */
export function applyLazyPollMeta(
  meta: Record<string, unknown>,
  source: LazyPollSource,
): void {
  if (source.isLazy()) meta['lazy'] = true
  if (source.getPollInterval() !== undefined) meta['pollInterval'] = source.getPollInterval()!
}

/** Apply lazy + pollInterval + live meta fields to a meta object. */
export function applyLazyPollLiveMeta(
  meta: Record<string, unknown>,
  source: LazyPollLiveSource,
): void {
  applyLazyPollMeta(meta, source)
  if (source.isLive()) meta['live'] = true
}

// ─── Auto-ID resolution ─���───────────────────────────────────

/**
 * Resolve the element ID for toMeta().
 * Returns the explicit ID if set, or auto-generates from fallback when
 * the element has a data function, is lazy, or has a poll interval.
 */
export function resolveElementId(
  explicitId: string | undefined,
  fallbackId: string,
  hasDataFn: boolean,
  source: LazyPollSource,
): string | undefined {
  return explicitId ?? (hasDataFn || source.isLazy() || source.getPollInterval() ? fallbackId : undefined)
}
