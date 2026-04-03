import { PanelRegistry, flattenFields } from '@rudderjs/panels'
import type { FieldOrGrouping, Field, QueryBuilderLike, RecordRow } from '@rudderjs/panels'
import { getSessionUser } from '../../../../_lib/getSessionUser.js'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

/** A Field with an optional `.apply(record)` method (ComputedField). */
interface ComputedFieldLike extends Field {
  apply(record: RecordRow): unknown
}

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
  const fullMeta     = resource.toMeta()
  // View page needs fields (for detail view), identity labels, and titleField
  const resourceMeta = {
    label:         fullMeta.label,
    labelSingular: fullMeta.labelSingular,
    fields:        fullMeta.fields,
    ...(fullMeta.titleField ? { titleField: fullMeta.titleField } : {}),
  }
  const panelMeta    = panel.toNavigationMeta()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Model  = ResourceClass.model as any
  const formFields = flattenFields(resource._resolveForm().getFields() as FieldOrGrouping[])

  let record: RecordRow | null = null
  if (Model) {
    let q: QueryBuilderLike<RecordRow> = Model.query()
    for (const f of formFields) {
      const type = f.getType()
      const name = f.getName()
      if (type === 'belongsTo') {
        // parentId → parent (or explicit relationName)
        const rel = ((f as unknown as { _extra: Record<string, unknown> })._extra?.['relationName'] as string) ?? (name.endsWith('Id') ? name.slice(0, -2) : name)
        q = q.with(rel)
      } else if (type === 'belongsToMany') {
        // field name IS the relation name (e.g. 'categories')
        q = q.with(name)
      }
    }
    record = await q.find(id)

    // Apply display transforms + computed fields (same as API endpoint)
    if (record) {
      const computedFields = formFields.filter((f): f is ComputedFieldLike => f.getType() === 'computed' && typeof (f as unknown as ComputedFieldLike).apply === 'function')
      const displayFields  = formFields.filter((f) => f.hasDisplay())

      if (computedFields.length || displayFields.length) {
        const rec: RecordRow = { ...record }
        for (const f of computedFields) rec[f.getName()] = f.apply(rec)
        for (const f of displayFields)  rec[f.getName()] = f.applyDisplay(rec[f.getName()], rec)
        record = rec
      }
    }
  }

  // ── SSR HasMany relation data ──────────────────────────────
  const hasManyData: Record<string, { records: RecordRow[]; schema: ReturnType<Field['toMeta']>[]; pagination: { total: number; currentPage: number; lastPage: number; perPage: number } }> = {}

  if (record) {
    for (const f of formFields) {
      if (f.getType() !== 'hasMany') continue
      const fExtra     = (f as unknown as { _extra: Record<string, unknown> })._extra
      const relSlug    = fExtra?.['resource'] as string | undefined
      const fk         = fExtra?.['foreignKey'] as string | undefined
      const throughMany = fExtra?.['throughMany'] === true
      const fieldName  = f.getName()
      if (!relSlug || !fk) continue

      const RelClass = panel.getResources().find((R) => R.getSlug() === relSlug)
      if (!RelClass) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RelModel = RelClass.model as any
      if (!RelModel) continue

      const relResource = new RelClass()
      const relFormFields = flattenFields(relResource._resolveForm().getFields() as FieldOrGrouping[])

      let q: QueryBuilderLike<RecordRow> = throughMany
        ? RelModel.query().where(fk, { some: { id } })
        : RelModel.query().where(fk, id)

      // Eager-load belongsTo and belongsToMany relations so CellValue can display them
      for (const rf of relFormFields) {
        const rfType = rf.getType()
        if (rfType === 'belongsTo') {
          const rname = rf.getName()
          const rel = ((rf as unknown as { _extra: Record<string, unknown> })._extra?.['relationName'] as string) ?? (rname.endsWith('Id') ? rname.slice(0, -2) : rname)
          q = q.with(rel)
        } else if (rfType === 'belongsToMany') {
          q = q.with(rf.getName())
        }
      }

      const result = await q.paginate(1, 15)

      const schema = relFormFields
        .filter((rf) => !rf.isHiddenFrom('table') && rf.getType() !== 'hasMany')
        .map((rf) => rf.toMeta())

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

  // Resolve resource detail widgets for the show page (new API: detail(), legacy: widgets())
  let widgetData: unknown[] = []
  try {
    const detailElements = resource.detail(record ?? undefined)
    if (detailElements.length > 0) {
      widgetData = detailElements.map((w) => w.toMeta())
    } else {
      // Legacy fallback: widgets()
      const widgets = resource.widgets(record ?? undefined)
      widgetData = widgets.map((w) => w.toMeta())
    }
  } catch { /* detail()/widgets() threw — skip */ }

  const sessionUser = await getSessionUser(pageContext)
  return {
    panelMeta, resourceMeta, record, pathSegment, slug, id, sessionUser,
    ...(Object.keys(hasManyData).length > 0 ? { hasManyData } : {}),
    ...(widgetData.length > 0 ? { widgetData } : {}),
  }
}
