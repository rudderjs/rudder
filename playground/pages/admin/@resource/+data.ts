import { PanelRegistry } from '@boostkit/panels'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const { resource: slug } = pageContext.routeParams as { resource: string }

  const panel = PanelRegistry.get('admin')
  if (!panel) throw new Error('Admin panel is not registered.')

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource    = new ResourceClass()
  const resourceMeta = resource.toMeta()
  const panelMeta   = panel.toMeta()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Model = ResourceClass.model as any
  const page  = Number(new URLSearchParams(pageContext.urlOriginal.split('?')[1] ?? '').get('page') ?? 1)

  let records: unknown[]                                = []
  let pagination: { total: number; currentPage: number; lastPage: number; perPage: number } | null = null

  if (Model) {
    const result = await Model.query().paginate(page, 15)
    records    = result.data
    pagination = {
      total:       result.total,
      currentPage: result.currentPage,
      lastPage:    result.lastPage,
      perPage:     result.perPage,
    }
  }

  return { panelMeta, resourceMeta, records, pagination, slug }
}
