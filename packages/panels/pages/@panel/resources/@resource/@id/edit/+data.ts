import { PanelRegistry } from '@boostkit/panels'
import type { FieldOrGrouping, Field, QueryBuilderLike, RecordRow } from '@boostkit/panels'
import { getSessionUser } from '../../../../../_lib/getSessionUser.js'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

function flattenFields(items: (Field | { getFields(): Field[] })[]): Field[] {
  const result: Field[] = []
  for (const item of items) {
    if ('getFields' in item) result.push(...flattenFields(item.getFields()))
    else result.push(item as Field)
  }
  return result
}

export async function data(pageContext: PageContextServer) {
  const { panel: pathSegment, resource: slug, id } = pageContext.routeParams as { panel: string; resource: string; id: string }

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource     = new ResourceClass()
  const resourceMeta = resource.toMeta()
  const panelMeta    = panel.toMeta()

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

  // Feature flags (independent)
  const versioned     = ResourceClass.versioned
  const draftable     = ResourceClass.draftable

  // Yjs needed if any field has .collaborative() or .persist('websocket'|'indexeddb')
  const needsYjs = formFields.some((f) => f.isYjs())

  // Check if any field actually needs websocket (vs indexeddb-only)
  const needsWebsocket = formFields.some((f) => {
    const providers: string[] = f.getYjsProviders()
    return providers.includes('websocket')
  })

  // Seed Y.Doc on first load (needed for both websocket and indexeddb)
  if (record && needsYjs && needsWebsocket) {
    try {
      const { Live } = await import('@boostkit/live')
      const docName = `panel:${slug}:${id}`
      const fieldData: Record<string, unknown> = {}
      for (const f of formFields) {
        const name = f.getName()
        if (name in record) {
          fieldData[name] = record[name]
        }
      }
      await Live.seed(docName, fieldData)
    } catch {
      // @boostkit/live not available — silently skip
    }
  }

  // Collect Yjs providers needed by fields
  const fieldProviders = new Set<string>()
  for (const f of formFields) {
    const providers: string[] = f.getYjsProviders()
    for (const p of providers) fieldProviders.add(p)
  }

  // Ensure websocket is always included when needed
  // eslint-disable-next-line prefer-const -- array is conditionally mutated below
  let liveProviders: string[] = [...fieldProviders]
  if (needsWebsocket) {
    if (!liveProviders.includes('websocket')) liveProviders.push('websocket')
  }

  const sessionUser = await getSessionUser(pageContext)
  return {
    panelMeta, resourceMeta, record, pathSegment, slug, id, sessionUser,
    versioned,
    draftable,
    yjs: needsYjs,
    wsLivePath: needsWebsocket ? '/ws-live' : null,
    docName:    needsYjs ? `panel:${slug}:${id}` : null,
    liveProviders: needsYjs ? liveProviders : [],
  }
}
