import { PanelRegistry } from '@boostkit/panels'
import { getSessionUser } from '../../../_lib/getSessionUser.js'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const { panel: pathSegment, global: slug } = pageContext.routeParams as { panel: string; global: string }

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const GlobalClass = panel.getGlobals().find((G) => G.getSlug() === slug)
  if (!GlobalClass) throw new Error(`Global "${slug}" not found.`)

  const global     = new GlobalClass()
  const globalMeta = global.toMeta()
  const panelMeta  = panel.toMeta()

  // Load current data from API
  let record: Record<string, unknown> = {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { app } = await import('@boostkit/core') as any
    const prisma  = app().make('prisma')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row     = await (prisma as any).panelGlobal.findUnique({ where: { slug } })
    if (row?.data) record = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
  } catch {
    // table not created yet or prisma not available
  }

  const sessionUser = await getSessionUser(pageContext)

  return {
    panelMeta,
    globalMeta,
    record,
    pathSegment,
    slug,
    sessionUser,
  }
}
