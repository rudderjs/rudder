import { PanelRegistry, resolveTable, resolveActiveTabIndex } from '@boostkit/panels'
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

  // ── Resolve the resource's table ──
  let tableElement: PanelSchemaElementMeta | null = null
  let tabsElement: PanelSchemaElementMeta | null = null

  if (ResourceClass.model) {
    const table = resource._resolveTable()
    const tableConfig = table.getConfig()

    if (tableConfig.tabs.length > 0) {
      // ── Tabs mode: build TabsMeta with per-tab resolved Table ──
      // Each tab gets its own Table clone with independent scope, ID, and persist.
      // We build the TabsMeta directly (not via resolveTabs) because each table
      // is already resolved through resolveTable() with SSR data + persist state.
      const tabsId = `${slug}-tabs`
      const resolvedTabs: { label: string; icon?: string; fields: never[]; elements: PanelSchemaElementMeta[] }[] = []

      for (const tab of tableConfig.tabs) {
        const tabName = tab.getLabel().toLowerCase().replace(/\s+/g, '-')
        const tabTableId = `${slug}-${tabName}`

        // Clone table with tab's scope and unique ID
        const tabTable = table._cloneWithScope(tabTableId, tab.getScope())

        // Resolve through the standard table pipeline (SSR data, persist, etc.)
        const resolvedTable = await resolveTable(tabTable as any, panel, ctx)

        // Override href for resource row links
        if (resolvedTable && 'href' in resolvedTable) {
          (resolvedTable as any).href = `/${pathSegment}/resources/${slug}`
        }
        if (resolvedTable && 'resource' in resolvedTable) {
          (resolvedTable as any).resource = slug
        }

        const tabMeta: { label: string; icon?: string; fields: never[]; elements: PanelSchemaElementMeta[] } = {
          label: tab.getLabel(),
          fields: [],
          elements: resolvedTable ? [resolvedTable] : [],
        }
        const icon = tab.getIcon()
        if (icon) tabMeta.icon = icon
        resolvedTabs.push(tabMeta)
      }

      // Resolve active tab from session/url persist (same as resolveTabs does for Pages)
      const persistMode = (tableConfig.remember || 'session') as import('@boostkit/panels').PersistMode
      const tabLabels = tableConfig.tabs.map(t => t.getLabel())
      const activeTabIndex = await resolveActiveTabIndex(persistMode, tabsId, tabLabels, ctx)

      tabsElement = {
        type: 'tabs',
        id: tabsId,
        tabs: resolvedTabs,
        persist: persistMode,
        ...(activeTabIndex > 0 ? { activeTab: activeTabIndex } : {}),
      } as unknown as PanelSchemaElementMeta

    } else {
      // ── No tabs: single table ──
      tableElement = await resolveTable(table as any, panel, ctx)

      if (tableElement && 'href' in tableElement) {
        (tableElement as any).href = `/${pathSegment}/resources/${slug}`
      }
      if (tableElement && 'resource' in tableElement) {
        (tableElement as any).resource = slug
      }
    }
  }

  return { panelMeta, resourceMeta, tableElement, tabsElement, pathSegment, slug, sessionUser }
}
