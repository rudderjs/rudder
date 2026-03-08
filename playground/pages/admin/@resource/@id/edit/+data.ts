import { PanelRegistry } from '@boostkit/panels'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const { resource: slug, id } = pageContext.routeParams as { resource: string; id: string }

  const panel = PanelRegistry.get('admin')
  if (!panel) throw new Error('Admin panel is not registered.')

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource     = new ResourceClass()
  const resourceMeta = resource.toMeta()
  const panelMeta    = panel.toMeta()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Model  = ResourceClass.model as any
  const record = Model ? await Model.find(id) : null

  return { panelMeta, resourceMeta, record, slug, id }
}
