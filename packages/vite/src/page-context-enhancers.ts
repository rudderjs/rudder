/**
 * Page-context enhancer registry.
 *
 * Framework packages register a function here from their provider's `boot()`;
 * the registered functions run on every page render via Vike's `+onCreatePageContext`
 * hook (wired in `hooks/onCreatePageContext.ts`).
 *
 * Use this for cross-cutting properties that should land on every `pageContext`
 * without per-view boilerplate — `pageContext.user`, `pageContext.locale`,
 * `pageContext.flash`, etc.
 *
 * Each enhancer should be fast — they run on every request.
 */

import type { PageContext } from 'vike/types'

export type PageContextEnhancer = (pageContext: PageContext) => void | Promise<void>

/**
 * Process-wide enhancer registry. Lives on `globalThis` so it survives
 * Vite SSR module re-evaluation in dev (same pattern as `__rudderjs_app__`).
 */
const REGISTRY_KEY = '__rudderjs_page_context_enhancers__'

function getRegistry(): PageContextEnhancer[] {
  const g = globalThis as Record<string, unknown>
  let registry = g[REGISTRY_KEY] as PageContextEnhancer[] | undefined
  if (!registry) {
    registry = []
    g[REGISTRY_KEY] = registry
  }
  return registry
}

/**
 * Register a function that runs on every page render.
 *
 * @example
 * // In a provider's boot()
 * registerPageContextEnhancer(async (pageContext) => {
 *   pageContext.user = await Auth.user()
 * })
 */
export function registerPageContextEnhancer(fn: PageContextEnhancer): void {
  getRegistry().push(fn)
}

/**
 * Run every registered enhancer against `pageContext`, in registration order.
 * Wired into Vike via `+onCreatePageContext`.
 */
export async function runPageContextEnhancers(pageContext: PageContext): Promise<void> {
  for (const fn of getRegistry()) {
    await fn(pageContext)
  }
}

/**
 * Clear the enhancer registry. Called by the dev re-boot (`performReboot`) so
 * the providers that register enhancers in `boot()` (auth → user, localization
 * → locale, session → flash) re-register cleanly each re-boot instead of
 * accumulating a duplicate enhancer per edit — the registry is globalThis-backed
 * and `registerPageContextEnhancer` only appends (no dedup). Mirrors the
 * `router.reset()` contract: the re-boot resets, providers re-register on the
 * next bootstrap. No-op in production (single boot, never re-entered).
 */
export function resetPageContextEnhancers(): void {
  const g = globalThis as Record<string, unknown>
  g[REGISTRY_KEY] = []
}

/** @deprecated Test alias — use {@link resetPageContextEnhancers}. */
export function _resetPageContextEnhancersForTests(): void {
  resetPageContextEnhancers()
}
