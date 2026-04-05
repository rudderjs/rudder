import { render } from 'vike/abort'
import type { PageContextServer } from 'vike/types'
import { PanelRegistry, resolveSchema } from '@rudderjs/panels'
import type { PanelNavigationMeta, PanelSchemaElementMeta } from '@rudderjs/panels'
import { buildPanelContext } from '../../_lib/buildPanelContext.js'
import type { SessionUser } from '../../_lib/getSessionUser.js'

export type Data = {
  panelMeta:   PanelNavigationMeta
  pageMeta:    { slug: string; label: string; icon: string | undefined }
  schemaData:  PanelSchemaElementMeta[]
  sessionUser: SessionUser | undefined
  pathSegment: string
  urlSearch?:  Record<string, string>
}

export async function data(pageContext: PageContextServer): Promise<Data> {
  if (!import.meta.env.SSR) {
    return {
      panelMeta: null as never,
      pageMeta: { slug: '', label: '', icon: undefined },
      schemaData: [],
      sessionUser: undefined,
      pathSegment: '',
    }
  }

  const { panel: pathSegment, page: pageSlug, ...pageParams } = pageContext.routeParams as {
    panel: string; page: string; [key: string]: string
  }

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw render(404)

  const PageClass = panel.getAllPages().find((P) => P.getSlug() === pageSlug)
  if (!PageClass) throw render(404)

  const panelMeta = panel.toNavigationMeta()
  const { ctx, sessionUser } = await buildPanelContext(pageContext, pageParams)

  // Built-in theme editor — no schema, pass config directly from panel
  if (pageSlug === 'theme') {
    return {
      panelMeta,
      pageMeta: PageClass.toMeta(),
      schemaData: [],
      sessionUser,
      pathSegment,
      slug: pageSlug,
      themeConfig: panel.getTheme() ?? {},
    }
  }

  if (!PageClass.hasSchema()) throw render(404)

  const elements = await PageClass.schema(ctx)
  const pagePanel = Object.create(panel, {
    getSchema: { value: () => elements },
  })
  const schemaData = await resolveSchema(pagePanel, ctx)

  const raw = pageContext.urlParsed?.search ?? {}
  const urlSearch = Object.keys(raw).length > 0 ? raw : undefined

  return {
    panelMeta,
    pageMeta: PageClass.toMeta(),
    schemaData,
    sessionUser,
    pathSegment,
    slug: pageSlug,
    ...(urlSearch ? { urlSearch } : {}),
  }
}
