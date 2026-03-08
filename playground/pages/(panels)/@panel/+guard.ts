import { redirect, render } from 'vike/abort'
import type { GuardAsync } from 'vike/types'

export const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  if (!import.meta.env.SSR) return
  const { PanelRegistry } = await import('@boostkit/panels')
  const { panel: pathSegment } = pageContext.routeParams as { panel: string }
  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)

  if (!panel) throw render(404)

  // Redirect root panel path to first resource
  if (pageContext.urlPathname === `/${pathSegment}`) {
    const first = panel.getResources()[0]
    if (first) throw redirect(`/${pathSegment}/${first.getSlug()}`)
  }
}
