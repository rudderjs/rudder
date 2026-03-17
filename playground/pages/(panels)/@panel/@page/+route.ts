import type { RouteSync } from 'vike/types'
import { PanelRegistry } from '@boostkit/panels'

// Match /{panel}/{page} where {page} is a registered schema-based Page.
//
// Resources live at /{panel}/resources/{slug} and globals at /{panel}/globals/{slug},
// so any 2-segment URL under a panel belongs to this route. On the client,
// PanelRegistry is empty (server-side only), so we trust the URL shape and let
// the data() hook throw 404 for invalid slugs.
export const route: RouteSync = (pageContext) => {
  const url = pageContext.urlPathname
  const parts = url.split('/').filter(Boolean) // e.g. ['admin', 'reports']
  if (parts.length !== 2) return false

  const [panelSegment, pageSlug] = parts

  // Client-side: PanelRegistry is empty — trust the 2-segment URL shape.
  if (!import.meta.env.SSR) {
    return { routeParams: { panel: panelSegment!, page: pageSlug! } }
  }

  // Server-side: fully validate against registered panels and pages.
  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${panelSegment}`)
  if (!panel) return false

  const PageClass = panel.getPages().find((P) => P.getSlug() === pageSlug)
  if (!PageClass) return false

  if (!PageClass.hasSchema()) return false

  return {
    routeParams: { panel: panelSegment!, page: pageSlug! },
  }
}
