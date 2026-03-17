import type { RouteSync } from 'vike/types'
import { PanelRegistry } from '@boostkit/panels'

// Match /{panel}/{page...} for registered schema-based Pages.
//
// Pages can have param slugs (e.g. 'orders/:id') matching multi-segment URLs.
// Resources live at /{panel}/resources/... and globals at /{panel}/globals/...,
// so those prefixes are excluded here.
//
// On the client PanelRegistry is empty, so we return a tentative match for any
// non-reserved URL under a panel and let the server validate via data().
export const route: RouteSync = (pageContext) => {
  const url = pageContext.urlPathname
  const parts = url.split('/').filter(Boolean)
  if (parts.length < 2) return false

  const [panelSegment, ...rest] = parts

  // Exclude reserved route groups
  if (rest[0] === 'resources' || rest[0] === 'globals') return false

  const urlPath = rest.join('/')

  // Client-side: trust the URL shape, server validates.
  if (!import.meta.env.SSR) {
    return { routeParams: { panel: panelSegment!, page: urlPath } }
  }

  // Server-side: find the first page whose slug pattern matches the URL path.
  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${panelSegment}`)
  if (!panel) return false

  for (const PageClass of panel.getPages()) {
    if (!PageClass.hasSchema()) continue
    const params = PageClass.matchPath(urlPath)
    if (params !== null) {
      // Strip undefined values — Vike routeParams must be strings
      const cleanParams = Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined)
      ) as Record<string, string>
      return {
        routeParams: { panel: panelSegment!, page: PageClass.getSlug(), ...cleanParams },
      }
    }
  }

  return false
}
