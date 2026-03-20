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

  const PageClass = panel.getAllPages().find((P) => P.getSlug() === pageSlug)
  if (!PageClass) throw render(404)

  // If this page doesn't have a schema, it should be handled by a Vike page file
  if (!PageClass.hasSchema()) throw render(404)

  const panelMeta = panel.toMeta()
  const sessionUser = await getSessionUser(pageContext)

  // Read session data from cookie for persist='session' tabs
  let sessionGet: ((key: string) => unknown) | undefined
  try {
    const { app: getApp } = await import('@boostkit/core') as { app(): { make<T>(key: string): T } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionConfig = getApp().make<any>('session.config')
    if (sessionConfig?.secret && sessionConfig?.cookie?.name) {
      const cookieHeader = ((pageContext as any).headers?.cookie ?? '') as string
      const cookieName = sessionConfig.cookie.name as string
      const match = cookieHeader.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith(`${cookieName}=`))
      if (match) {
        const cookieValue = decodeURIComponent(match.slice(cookieName.length + 1))
        const { createHmac } = await import('node:crypto')
        const dotIdx = cookieValue.lastIndexOf('.')
        if (dotIdx !== -1) {
          const b64 = cookieValue.slice(0, dotIdx)
          const hmac = cookieValue.slice(dotIdx + 1)
          const expected = createHmac('sha256', sessionConfig.secret as string).update(b64).digest('base64url')
          if (expected === hmac) {
            const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as { data: Record<string, unknown> }
            sessionGet = (key: string) => payload.data[key]
          }
        }
      }
    }
  } catch { /* session not available */ }

  const ctx = {
    user: sessionUser as PanelUser | undefined,
    headers: (pageContext as PageContextServer & { headers?: Record<string, string> }).headers ?? {},
    path: pageContext.urlPathname,
    params: pageParams,
    urlSearch: pageContext.urlParsed?.search ?? {},
    sessionGet,
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
