import { PanelRegistry } from '@boostkit/panels'
import { getSessionUser } from '../../../../_lib/getSessionUser.js'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const { panel: pathSegment, resource: slug, id } = pageContext.routeParams as {
    panel:    string
    resource: string
    id:       string
  }

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource     = new ResourceClass()
  const resourceMeta = resource.toMeta()
  const panelMeta    = panel.toMeta()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Model  = ResourceClass.model as any
  function flattenFields(items: any[]): any[] {
    const result: any[] = []
    for (const item of items) {
      if ('getFields' in item) result.push(...flattenFields(item.getFields()))
      else result.push(item)
    }
    return result
  }

  let record   = null
  if (Model) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = Model.query()
    for (const f of flattenFields(resource.fields())) {
      const type = (f as any).getType?.() as string | undefined
      const name = (f as any).getName() as string
      if (type === 'belongsTo') {
        // parentId → parent (or explicit relationName)
        const rel = ((f as any)._extra?.['relationName'] as string) ?? (name.endsWith('Id') ? name.slice(0, -2) : name)
        q = q.with(rel)
      } else if (type === 'belongsToMany') {
        // field name IS the relation name (e.g. 'categories')
        q = q.with(name)
      }
    }
    record = await q.find(id)

    // Apply display transforms + computed fields (same as API endpoint)
    if (record) {
      const allFields = flattenFields(resource.fields())
      const computedFields = allFields.filter((f: any) => f.getType?.() === 'computed' && typeof f.apply === 'function')
      const displayFields  = allFields.filter((f: any) => typeof f.hasDisplay === 'function' && f.hasDisplay())

      if (computedFields.length || displayFields.length) {
        const rec = { ...record } as Record<string, unknown>
        for (const f of computedFields) rec[(f as any).getName()] = (f as any).apply(rec)
        for (const f of displayFields)  rec[(f as any).getName()] = (f as any).applyDisplay(rec[(f as any).getName()], rec)
        record = rec
      }
    }
  }

  // ── SSR HasMany relation data ──────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasManyData: Record<string, { records: any[]; schema: any[]; pagination: { total: number; currentPage: number; lastPage: number; perPage: number } }> = {}

  if (record) {
    for (const f of flattenFields(resource.fields())) {
      if ((f as any).getType?.() !== 'hasMany') continue
      const relSlug    = (f as any)._extra?.['resource'] as string | undefined
      const fk         = (f as any)._extra?.['foreignKey'] as string | undefined
      const throughMany = (f as any)._extra?.['throughMany'] === true
      const fieldName  = (f as any).getName() as string
      if (!relSlug || !fk) continue

      const RelClass = panel.getResources().find((R) => R.getSlug() === relSlug)
      if (!RelClass) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RelModel = (RelClass as any).model as any
      if (!RelModel) continue

      const relResource = new RelClass()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = throughMany
        ? RelModel.query().where(fk, { some: { id } })
        : RelModel.query().where(fk, id)

      // Eager-load belongsTo and belongsToMany relations so CellValue can display them
      for (const rf of flattenFields(relResource.fields())) {
        const rfType = (rf as any).getType?.() as string | undefined
        if (rfType === 'belongsTo') {
          const rname = (rf as any).getName() as string
          const rel = ((rf as any)._extra?.['relationName'] as string) ?? (rname.endsWith('Id') ? rname.slice(0, -2) : rname)
          q = q.with(rel)
        } else if (rfType === 'belongsToMany') {
          q = q.with((rf as any).getName() as string)
        }
      }

      const result = await q.paginate(1, 15)

      const schema = flattenFields(relResource.fields())
        .filter((rf: any) => !rf.isHiddenFrom?.('table') && rf.getType?.() !== 'hasMany')
        .map((rf: any) => rf.toMeta())

      hasManyData[fieldName] = {
        records:    result.data,
        schema,
        pagination: {
          total:       result.total,
          currentPage: result.currentPage,
          lastPage:    result.lastPage,
          perPage:     result.perPage,
        },
      }
    }
  }

  // Resolve resource widgets for the show page
  let widgetData: unknown[] = []
  try {
    const widgets = resource.widgets(record as Record<string, unknown> ?? undefined)
    widgetData = widgets.map((w: any) => w.toMeta())
  } catch { /* widgets() threw — skip */ }

  const sessionUser = await getSessionUser(pageContext)
  return { panelMeta, resourceMeta, record, pathSegment, slug, id, hasManyData, widgetData, sessionUser }
}
