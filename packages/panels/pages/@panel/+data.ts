import { render } from 'vike/abort'
import type { PageContextServer } from 'vike/types'
import { PanelRegistry, resolveSchema } from '@rudderjs/panels'
import type { PanelNavigationMeta, PanelSchemaElementMeta } from '@rudderjs/panels'
import { buildPanelContext } from '../_lib/buildPanelContext.js'
import type { SessionUser } from '../_lib/getSessionUser.js'

export type Data = {
  panelMeta:   PanelNavigationMeta
  schemaData:  PanelSchemaElementMeta[]
  sessionUser: SessionUser | undefined
  urlSearch?:  Record<string, string>
}

export async function data(pageContext: PageContextServer): Promise<Data> {
  if (!import.meta.env.SSR) {
    return { panelMeta: null as never, schemaData: [], sessionUser: undefined }
  }

  const { panel: pathSegment } = pageContext.routeParams as { panel: string }
  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw render(404)

  const panelMeta = panel.toNavigationMeta()
  const { ctx, sessionUser } = await buildPanelContext(pageContext)

  let schemaData: PanelSchemaElementMeta[] = []
  if (panel.hasSchema()) {
    schemaData = await resolveSchema(panel, ctx)
  }

  const raw = pageContext.urlParsed?.search ?? {}
  const urlSearch = Object.keys(raw).length > 0 ? raw : undefined

  return { panelMeta, schemaData, sessionUser, ...(urlSearch ? { urlSearch } : {}) }
}
