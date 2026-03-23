import type { PageContextServer } from 'vike/types'
import type { MediaRecord } from '../../_lib/types.js'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const { panel: pathSegment } = pageContext.routeParams as { panel: string }

  // Resolve panel
  const { PanelRegistry } = await import('@boostkit/panels')
  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const panelMeta = panel.toMeta()

  // Parse query params
  const params = new URLSearchParams(pageContext.urlOriginal.split('?')[1] ?? '')
  const parentId = params.get('folder') || null
  const scope = params.get('scope') === 'private' ? 'private' as const : 'shared' as const
  const search = params.get('search') ?? ''

  // Get Prisma
  const { resolve } = await import('@boostkit/core')
  const prisma = resolve<{ media: {
    findMany(args: Record<string, unknown>): Promise<unknown[]>
    findUnique(args: Record<string, unknown>): Promise<unknown | null>
  } }>('prisma')

  // Build query
  const where: Record<string, unknown> = {
    parentId,
    scope,
  }

  if (search) {
    where['name'] = { contains: search, mode: 'insensitive' }
  }

  // Get session user for private scope
  let sessionUser: { id: string; name: string; email: string } | null = null
  try {
    const { getSessionUser } = await import('../../_lib/getSessionUser.js')
    sessionUser = await getSessionUser(pageContext)
  } catch { /* no session */ }

  if (scope === 'private' && sessionUser) {
    where['userId'] = sessionUser.id
  }

  const items = await prisma.media.findMany({
    where,
    orderBy: [
      { type: 'asc' },  // folders first
      { name: 'asc' },
    ],
  }) as MediaRecord[]

  // Get current folder info
  let currentFolder: MediaRecord | null = null
  if (parentId) {
    currentFolder = await prisma.media.findUnique({ where: { id: parentId } }) as MediaRecord | null
  }

  // Build breadcrumbs
  const breadcrumbs: Array<{ id: string; name: string }> = []
  if (parentId && currentFolder) {
    let current: { id: string; name: string; parentId: string | null } | null = currentFolder
    while (current) {
      breadcrumbs.unshift({ id: current.id, name: current.name })
      current = current.parentId
        ? await prisma.media.findUnique({ where: { id: current.parentId } }) as typeof current
        : null
    }
  }

  return {
    panelMeta,
    items,
    currentFolder,
    breadcrumbs,
    scope,
    search,
    pathSegment,
    sessionUser,
  }
}
