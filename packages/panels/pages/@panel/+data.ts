import { render }                              from 'vike/abort'
import type { PageContextServer }              from 'vike/types'
import { PanelRegistry, resolveSchema }        from '@boostkit/panels'
import type { PanelMeta, PanelSchemaElementMeta } from '@boostkit/panels'
import { getSessionUser }                      from '../_lib/getSessionUser.js'
import type { SessionUser }                    from '../_lib/getSessionUser.js'

export type Data = {
  panelMeta:   PanelMeta
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

  const panelMeta = panel.toMeta()

  const sessionUser = await getSessionUser(pageContext)

  let schemaData: PanelSchemaElementMeta[] = []
  if (panel.hasSchema()) {
    schemaData = await resolveSchema(panel, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user:    sessionUser as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headers: (pageContext as any).headers ?? {},
      path:    pageContext.urlPathname,
      params:  {},
      urlSearch: pageContext.urlParsed?.search ?? {},
    })
  }

  // Pass URL search string so schema tabs can SSR the correct active tab
  const urlSearch = pageContext.urlParsed?.search ?? {}

  return { panelMeta, schemaData, slug: undefined, sessionUser, urlSearch }
}
