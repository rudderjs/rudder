import { render } from 'vike/abort'
import type { PageContextServer } from 'vike/types'
import { PanelRegistry, resolveSchema } from '@boostkit/panels'
import type { PanelNavigationMeta, PanelSchemaElementMeta } from '@boostkit/panels'
import { buildPanelContext } from '../_lib/buildPanelContext.js'
import type { SessionUser } from '../_lib/getSessionUser.js'

export type Data = {
  panelMeta:   PanelNavigationMeta
  schemaData:  PanelSchemaElementMeta[]
  slug:        undefined
  sessionUser: SessionUser | undefined
  urlSearch:   Record<string, string>
}

export async function data(pageContext: PageContextServer): Promise<Data> {
  if (!import.meta.env.SSR) {
    return { panelMeta: null as never, schemaData: [], slug: undefined, sessionUser: undefined, urlSearch: {} }
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

  const urlSearch = pageContext.urlParsed?.search ?? {}

  return { panelMeta, schemaData, slug: undefined, sessionUser, urlSearch }
}
