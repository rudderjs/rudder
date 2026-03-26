import { PanelRegistry, resolveForm, flattenFields } from '@boostkit/panels'
import type { FieldOrGrouping, Field, QueryBuilderLike, RecordRow, PanelSchemaElementMeta } from '@boostkit/panels'
import { buildPanelContext } from '../../../../../_lib/buildPanelContext.js'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const { panel: pathSegment, resource: slug, id } = pageContext.routeParams as { panel: string; resource: string; id: string }

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource     = new ResourceClass()
  const fullMeta     = resource.toMeta()
  // Edit page only needs identity labels — form config is in formElement
  const resourceMeta = { label: fullMeta.label, labelSingular: fullMeta.labelSingular }
  const panelMeta    = panel.toNavigationMeta()
  const { ctx, sessionUser } = await buildPanelContext(pageContext)

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
        const rel = ((f as unknown as { _extra: Record<string, unknown> })._extra?.['relationName'] as string) ?? (name.endsWith('Id') ? name.slice(0, -2) : name)
        q = q.with(rel)
      } else if (type === 'belongsToMany') {
        q = q.with(name)
      }
    }
    record = await q.find(id)
  }

  // Resolve the resource form through resolveForm()
  const form = resource._resolveForm()
  form.action(`/${pathSegment}/api/${slug}/${id}`)
  form.method('PUT')
  if (record) {
    form.data(async () => record as Record<string, unknown>)
  }

  const formElement = await resolveForm(form as any, panel, ctx)

  // Override docName to use resource-specific name (panel:slug:id, not form:slug)
  const formMeta = formElement as PanelSchemaElementMeta & { yjs?: boolean; wsLivePath?: string | null; docName?: string | null; liveProviders?: string[] }
  if (formMeta.yjs) {
    const resourceDocName = `panel:${slug}:${id}`
    formMeta.docName = resourceDocName

    if (formMeta.wsLivePath && record) {
      try {
        const { Live } = await import('@boostkit/live')
        const fieldData: Record<string, unknown> = {}
        const collabFields = formFields.filter((f: Field) => f.isYjs())

        for (const f of formFields) {
          const name = f.getName()
          if (name in record) fieldData[name] = record[name]
        }

        await Live.seed(resourceDocName, fieldData)
      } catch { /* @boostkit/live not available */ }
    }
  }

  return { panelMeta, resourceMeta, formElement, pathSegment, slug, id, sessionUser }
}
