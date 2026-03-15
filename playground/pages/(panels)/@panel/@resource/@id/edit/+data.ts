import { PanelRegistry } from '@boostkit/panels'
import { getSessionUser } from '../../../../_lib/getSessionUser.js'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function flattenFields(items: any[]): any[] {
    const result: any[] = []
    for (const item of items) {
      if ('getFields' in item) result.push(...flattenFields(item.getFields()))
      else result.push(item)
    }
    return result
  }

  let record = null
  if (Model) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = Model.query()
    for (const f of flattenFields(resource.fields())) {
      const type = (f as any).getType?.() as string | undefined
      const name = (f as any).getName() as string
      if (type === 'belongsTo') {
        const rel = ((f as any)._extra?.['relationName'] as string) ?? (name.endsWith('Id') ? name.slice(0, -2) : name)
        q = q.with(rel)
      } else if (type === 'belongsToMany') {
        q = q.with(name)
      }
    }
    record = await q.find(id)
  }

  // Feature flags (independent)
  const versioned     = (ResourceClass as any).versioned ?? false
  const draftable     = (ResourceClass as any).draftable ?? false
  // Derive collaborative from fields — true if any field has .collaborative()
  const collaborative = flattenFields(resource.fields()).some(
    (f: any) => typeof f.isCollaborative === 'function' && f.isCollaborative()
  )

  // Collaborative: seed ydoc on first load, then merge ydoc values into record
  if (record && collaborative) {
    try {
      const { Live } = await import('@boostkit/live')
      const docName = `panel:${slug}:${id}`
      const fieldData: Record<string, unknown> = {}
      for (const f of flattenFields(resource.fields())) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const name = (f as any).getName() as string
        if (name in (record as Record<string, unknown>)) {
          fieldData[name] = (record as Record<string, unknown>)[name]
        }
      }
      await Live.seed(docName, fieldData)
    } catch {
      // @boostkit/live not available — silently skip
    }
  }

  // Read client-side providers from live config
  let liveProviders: string[] = ['websocket']
  if (collaborative) {
    try {
      const configs = await import('../../../../../../config/index.js')
      liveProviders = (configs.default as any)?.live?.providers ?? ['websocket']
    } catch {
      // config not available — use default
    }
  }

  const sessionUser = await getSessionUser(pageContext)
  return {
    panelMeta, resourceMeta, record, pathSegment, slug, id, sessionUser,
    versioned,
    draftable,
    collaborative,
    wsLivePath: collaborative ? '/ws-live' : null,
    docName:    collaborative ? `panel:${slug}:${id}` : null,
    liveProviders: collaborative ? liveProviders : [],
  }
}
