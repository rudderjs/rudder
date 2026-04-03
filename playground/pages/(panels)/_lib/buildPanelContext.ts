import type { PanelUser } from '@rudderjs/panels'
import type { PageContextServer } from 'vike/types'
import { getSessionUser } from './getSessionUser.js'

export interface PanelContext {
  user:       PanelUser | undefined
  headers:    Record<string, string>
  path:       string
  params:     Record<string, string>
  urlSearch:  Record<string, string>
  sessionGet?: (key: string) => unknown
}

/**
 * Build a PanelContext from Vike's PageContextServer.
 * Reads session cookie for persist='session' support (tables, tabs, forms).
 * Shared across all +data.ts files — no more duplicated session parsing.
 */
export async function buildPanelContext(
  pageContext: PageContextServer,
  params: Record<string, string> = {},
): Promise<{ ctx: PanelContext; sessionUser: ReturnType<typeof getSessionUser> extends Promise<infer T> ? T : never }> {
  const sessionUser = await getSessionUser(pageContext)

  let sessionGet: ((key: string) => unknown) | undefined
  try {
    const { app: getApp } = await import('@rudderjs/core') as { app(): { make<T>(key: string): T } }
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

  const ctx: PanelContext = {
    user: sessionUser as PanelUser | undefined,
    headers: (pageContext as PageContextServer & { headers?: Record<string, string> }).headers ?? {},
    path: pageContext.urlPathname,
    params,
    urlSearch: pageContext.urlParsed?.search ?? {},
    sessionGet,
  }

  return { ctx, sessionUser }
}
