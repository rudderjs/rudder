import type { PageContext } from 'vike/types'

/**
 * Vike `+headersResponse` hook — returns the response headers for the page.
 *
 * Sources headers from `pageContext.viewHeaders`, which `@rudderjs/view`'s
 * `ViewResponse.toResponse()` sets on the renderPage() call. Pages rendered
 * outside of `view()` (file-based Vike pages with no controller) have an
 * empty `viewHeaders` and this returns `{}` — Vike merges it with the
 * defaults so no harm done.
 */
export function headersResponse(pageContext: PageContext): Record<string, string> {
  return (pageContext as { viewHeaders?: Record<string, string> }).viewHeaders ?? {}
}
