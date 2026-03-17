import type { RouteSync } from 'vike/types'
import { PanelRegistry } from '@boostkit/panels'

// Match /{panel}/{page} where {page} is a registered schema-based Page
export const route: RouteSync = (pageContext) => {
  const url = pageContext.urlPathname
  const parts = url.split('/').filter(Boolean) // e.g. ['admin', 'reports']
  if (parts.length !== 2) return false

  const [panelSegment, pageSlug] = parts
  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${panelSegment}`)
  if (!panel) return false

  const PageClass = panel.getPages().find((P) => P.getSlug() === pageSlug)
  if (!PageClass) return false

  // Only match pages with schema — Vike file-based pages handle the rest
  if (!PageClass.hasSchema()) return false

  return {
    routeParams: { panel: panelSegment!, page: pageSlug! },
  }
}
