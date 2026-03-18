import { render } from 'vike/abort'
import type { PageContextServer } from 'vike/types'
import { PanelRegistry, resolveSchema } from '@boostkit/panels'
import type { PanelMeta, PanelSchemaElementMeta, PanelUser } from '@boostkit/panels'
import { getSessionUser } from '../../_lib/getSessionUser.js'
import type { SessionUser } from '../../_lib/getSessionUser.js'

export type Data = {
  panelMeta:   PanelMeta
  pageMeta:    { slug: string; label: string; icon: string | undefined }
  schemaData:  PanelSchemaElementMeta[]
  sessionUser: SessionUser | undefined
  pathSegment: string
  urlSearch:   Record<string, string>
}

export async function data(pageContext: PageContextServer): Promise<Data> {
  if (!import.meta.env.SSR) {
    return {
      panelMeta: null as never,
      pageMeta: { slug: '', label: '', icon: undefined },
      schemaData: [],
      sessionUser: undefined,
      pathSegment: '',
      urlSearch: {},
    }
  }

  const { panel: pathSegment, page: pageSlug, ...pageParams } = pageContext.routeParams as {
    panel: string; page: string; [key: string]: string
  }

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw render(404)

  const PageClass = panel.getPages().find((P) => P.getSlug() === pageSlug)
  if (!PageClass) throw render(404)

  // If this page doesn't have a schema, it should be handled by a Vike page file
  if (!PageClass.hasSchema()) throw render(404)

  const panelMeta = panel.toMeta()
  const sessionUser = await getSessionUser(pageContext)

  const ctx = {
    user: sessionUser as PanelUser | undefined,
    headers: (pageContext as PageContextServer & { headers?: Record<string, string> }).headers ?? {},
    path: pageContext.urlPathname,
    params: pageParams,
  }

  // Call schema() directly — works for both overridden methods and define() definitions
  const elements = await PageClass.schema(ctx)

  // Use resolveSchema with a proxy panel that returns the page elements
  const pagePanel = Object.create(panel, {
    getSchema: { value: () => elements },
  })
  const schemaData = await resolveSchema(pagePanel, ctx)

  const urlSearch = pageContext.urlParsed?.search ?? {}

  return {
    panelMeta,
    pageMeta: PageClass.toMeta(),
    schemaData,
    sessionUser,
    pathSegment,
    urlSearch,
  }
}
