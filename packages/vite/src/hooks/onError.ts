import type { PageContext } from 'vike/types'

/**
 * Vike `+onError` hook — receives every SSR error.
 *
 * Routes the error through `@rudderjs/core`'s `report()` so SSR errors land in
 * the same reporter / renderer chain as HTTP route errors. Falls back to
 * `console.error` when `@rudderjs/core` isn't installed (the package is an
 * optional runtime peer — `@rudderjs/vite` is usable standalone).
 *
 * The lazy import means cold-boot apps pay the import cost on first error
 * only; non-erroring requests never load `@rudderjs/core` through this path.
 */
export async function onError(error: unknown, pageContext: PageContext): Promise<void> {
  try {
    const core = await import('@rudderjs/core').catch(() => null) as { report?: (err: unknown, ctx?: Record<string, unknown>) => void } | null
    if (core?.report) {
      core.report(error, { source: 'vike', url: pageContext.urlOriginal })
      return
    }
  } catch {
    // fall through to console
  }
  console.error('[RudderJS] Vike SSR error:', error)
}
