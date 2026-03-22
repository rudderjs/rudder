import { PanelRegistry, resolveTable } from '@boostkit/panels'
import type { PanelSchemaElementMeta, PanelUser } from '@boostkit/panels'
import { getSessionUser } from '../../../_lib/getSessionUser.js'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const { panel: pathSegment, resource: slug } = pageContext.routeParams as { panel: string; resource: string }

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource     = new ResourceClass()
  const resourceMeta = resource.toMeta()
  const panelMeta    = panel.toMeta()
  const sessionUser  = await getSessionUser(pageContext)

  // ── Build PanelContext with session support (for persist='session') ──
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
    params: {},
    urlSearch: pageContext.urlParsed?.search ?? {},
    sessionGet,
  }

  // ── Resolve the resource's table through the same pipeline as standalone tables ──
  // This gives us: SSR records, pagination, persist state (session/url/localStorage),
  // search, sort, filters — all handled by resolveTable()
  let tableElement: PanelSchemaElementMeta | null = null
  if (ResourceClass.model) {
    const table = resource._resolveTable()
    tableElement = await resolveTable(table as any, panel, ctx)

    // Override href for resource row links
    if (tableElement && 'href' in tableElement) {
      (tableElement as any).href = `/${pathSegment}/resources/${slug}`
    }
    // Override resource slug for API endpoint routing
    if (tableElement && 'resource' in tableElement) {
      (tableElement as any).resource = slug
    }
  }

  return { panelMeta, resourceMeta, tableElement, pathSegment, slug, sessionUser }
}
