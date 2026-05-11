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
 * Test-only: clear the registry. NEVER call from app code.
 */
export function _resetPageContextEnhancersForTests(): void {
  const g = globalThis as Record<string, unknown>
  g[REGISTRY_KEY] = []
}
