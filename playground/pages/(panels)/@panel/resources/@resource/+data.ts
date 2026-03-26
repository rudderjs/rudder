import { PanelRegistry, resolveTable } from '@boostkit/panels'
import type { PanelSchemaElementMeta } from '@boostkit/panels'
import { buildPanelContext } from '../../../_lib/buildPanelContext.js'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const { panel: pathSegment, resource: slug } = pageContext.routeParams as { panel: string; resource: string }

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource     = new ResourceClass()
  const resourceMeta = resource.toMeta()
  const panelMeta    = panel.toNavigationMeta()
  const { ctx, sessionUser } = await buildPanelContext(pageContext)

  // resolveTable handles both plain tables and tables with .tabs() (returns tabs meta)
  let element: PanelSchemaElementMeta | null = null
  if (ResourceClass.model) {
    const table = resource._resolveTable()
    element = await resolveTable(table as any, panel, ctx)

    // Apply resource-specific overrides
    if (element) {
      const el = element as PanelSchemaElementMeta & Record<string, unknown>
      if (el.type === 'table') {
        el['href'] = `/${pathSegment}/resources/${slug}`
        el['resource'] = slug
        if (el['live']) el['liveChannel'] = `panel:${slug}`
      } else if (el.type === 'tabs') {
        // Tabs wrapping per-tab tables — apply overrides to each inner table
        const tabs = (el as any).tabs as { elements?: PanelSchemaElementMeta[] }[]
        for (const tab of tabs) {
          for (const inner of tab.elements ?? []) {
            const t = inner as PanelSchemaElementMeta & Record<string, unknown>
            if (t.type === 'table') {
              t['href'] = `/${pathSegment}/resources/${slug}`
              t['resource'] = ''
              if (t['live']) t['liveChannel'] = `panel:${slug}`
            }
          }
        }
      }
    }
  }

  return { panelMeta, resourceMeta, element, pathSegment, slug, sessionUser }
}
