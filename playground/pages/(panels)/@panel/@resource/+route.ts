import type { RouteSync } from 'vike/types'
import { PanelRegistry } from '@boostkit/panels'

// Match /{panel}/{resource} only when {resource} is a registered Resource slug
export const route: RouteSync = (pageContext) => {
  const url = pageContext.urlPathname
  const parts = url.split('/').filter(Boolean)
  if (parts.length !== 2) return false

  const [panelSegment, resourceSlug] = parts
  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${panelSegment}`)
  if (!panel) return false

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === resourceSlug)
  if (!ResourceClass) return false

  return {
    routeParams: { panel: panelSegment!, resource: resourceSlug! },
  }
}
