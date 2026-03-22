import { render }                              from 'vike/abort'
import type { PageContextServer }              from 'vike/types'
import { PanelRegistry, resolveSchema } from '@boostkit/panels'
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

  // Read session data from cookie for persist='session' tabs
  // (Vike SSR runs outside SessionMiddleware's AsyncLocalStorage, so we decode the cookie directly)
  let sessionGet: ((key: string) => unknown) | undefined
  try {
    const { app } = await import('@boostkit/core') as { app(): { make<T>(key: string): T } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionConfig = app().make<any>('session.config')
    if (sessionConfig?.secret && sessionConfig?.cookie?.name) {
      const cookieHeader = ((pageContext as any).headers?.cookie ?? '') as string
      const cookieName = sessionConfig.cookie.name as string
      const match = cookieHeader.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith(`${cookieName}=`))
      if (match) {
        const cookieValue = decodeURIComponent(match.slice(cookieName.length + 1))
        // Verify HMAC and decode payload (same logic as CookieDriver)
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
      sessionGet,
    })
  }

  // Pass URL search string so schema tabs can SSR the correct active tab
  const urlSearch = pageContext.urlParsed?.search ?? {}

  return { panelMeta, schemaData, slug: undefined, sessionUser, urlSearch }
}
