import { PanelRegistry } from '@pilotiq/panels'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const { panel: pathSegment } = pageContext.routeParams as { panel: string }
  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)
  return { panelMeta: panel.toNavigationMeta(), slug: 'custom' }
}
