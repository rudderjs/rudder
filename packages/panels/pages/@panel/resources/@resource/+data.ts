import { PanelRegistry, resolveDataView } from '@rudderjs/panels'
import type { PanelSchemaElementMeta } from '@rudderjs/panels'
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
  const fullMeta     = resource.toMeta()
  // List page only needs identity + a few flags — everything else is in the dataview element
  const resourceMeta: Record<string, unknown> = {
    label:          fullMeta.label,
    labelSingular:  fullMeta.labelSingular,
  }
  if (fullMeta.softDeletes)           resourceMeta.softDeletes           = true
  if (fullMeta.draftable)             resourceMeta.draftable             = true
  if (fullMeta.emptyStateIcon)        resourceMeta.emptyStateIcon        = fullMeta.emptyStateIcon
  if (fullMeta.emptyStateHeading)     resourceMeta.emptyStateHeading     = fullMeta.emptyStateHeading
  if (fullMeta.emptyStateDescription) resourceMeta.emptyStateDescription = fullMeta.emptyStateDescription
  const panelMeta    = panel.toNavigationMeta()
  const { ctx, sessionUser } = await buildPanelContext(pageContext)

  // Resolve resource table as a DataView element
  let element: PanelSchemaElementMeta | null = null
  if (ResourceClass.model) {
    const table = resource._resolveTable()
    element = await resolveDataView(table, panel, ctx)

    // Apply resource-specific overrides
    if (element) {
      const el = element as PanelSchemaElementMeta & Record<string, unknown>
      el['resource'] = slug
      if (el['live']) el['liveChannel'] = `panel:${slug}`
    }
  }

  return { panelMeta, resourceMeta, element, pathSegment, slug, sessionUser }
}
