import type { Media, MediaElementMeta } from './schema/Media.js'
import type { MediaRecord } from './types.js'

interface PrismaMedia {
  findMany(args: Record<string, unknown>): Promise<unknown[]>
  findUnique(args: Record<string, unknown>): Promise<unknown | null>
  count(args?: Record<string, unknown>): Promise<number>
}

interface PanelContext {
  urlSearch?: Record<string, string>
  sessionGet?: (key: string) => unknown
}

async function getPrisma(): Promise<{ media: PrismaMedia }> {
  const { resolve } = await import(/* @vite-ignore */ '@boostkit/core')
  return resolve<{ media: PrismaMedia }>('prisma')
}

/** Read persisted state from URL params or session (same logic as panels readPersistedState). */
function readPersisted(
  mode: false | 'localStorage' | 'url' | 'session',
  key: string,
  ctx: PanelContext,
): Record<string, string> {
  if (!mode) return {}

  if (mode === 'url' && ctx.urlSearch) {
    const state: Record<string, string> = {}
    for (const [k, v] of Object.entries(ctx.urlSearch)) {
      if (k.startsWith(`${key}_`)) state[k.slice(key.length + 1)] = v
    }
    return state
  }

  if (mode === 'session' && ctx.sessionGet) {
    try {
      const stored = ctx.sessionGet(key)
      if (stored && typeof stored === 'object') return stored as Record<string, string>
    } catch { /* session not available */ }
  }

  return {}
}

/**
 * SSR resolver for Media.make() schema element.
 *
 * - Default (lazy): returns empty meta, client fetches on mount
 * - `.ssr()`: pre-loads items with persisted state (page, search, sort, library)
 */
export async function resolveMedia(el: unknown, ctx: unknown): Promise<MediaElementMeta> {
  const media = el as Media
  const meta = media.toMeta()

  if (!media.isSsr()) return meta

  try {
    const prisma = await getPrisma()
    const panelCtx = (ctx ?? {}) as PanelContext
    const persistKey = `media:${media.getId()}`
    const persisted = readPersisted(media.getPersist(), persistKey, panelCtx)

    // Resolve state from persisted values or defaults
    const activePage = persisted['page'] ? Number(persisted['page']) || 1 : 1
    const activeSearch = persisted['search'] || ''
    const activeSort = persisted['sort'] || media.getSortBy()
    const activeSortDir = (persisted['dir'] || media.getSortDir()) as 'asc' | 'desc'
    const activeLibName = persisted['library'] || meta.activeLibrary

    // Resolve library
    const activeLib = meta.libraries.find(l => l.name === activeLibName) ?? meta.libraries[0]
    if (activeLib) meta.activeLibrary = activeLib.name

    const parentId = media.getParentId()
    const perPage = media.getPerPage()

    const where: Record<string, unknown> = {
      parentId,
      scope: media.getScope(),
    }

    if (activeLib?.directory) {
      where['directory'] = { startsWith: activeLib.directory }
    }

    if (activeSearch) {
      where['name'] = { contains: activeSearch }
    }

    // Build orderBy — folders first, then user sort
    const orderBy: Record<string, string>[] = [
      { type: 'asc' },
      { [activeSort]: activeSortDir },
    ]

    const findArgs: Record<string, unknown> = { where, orderBy }

    if (perPage) {
      findArgs['take'] = perPage
      findArgs['skip'] = (activePage - 1) * perPage
    }

    meta.items = await prisma.media.findMany(findArgs) as MediaRecord[]

    if (perPage) {
      const total = await prisma.media.count({ where } as Record<string, unknown>)
      meta.totalItems = total
      meta.totalPages = Math.ceil(total / perPage)
      meta.currentPage = activePage
    }

    // Set active state in meta for the client to hydrate from
    if (activeSearch) meta.sortBy = activeSort
    if (activeSortDir !== 'asc') meta.sortDir = activeSortDir

    if (parentId) {
      let current = await prisma.media.findUnique({ where: { id: parentId } }) as MediaRecord | null
      meta.currentFolder = current
      while (current) {
        meta.breadcrumbs.unshift({ id: current.id, name: current.name })
        current = current.parentId
          ? await prisma.media.findUnique({ where: { id: current.parentId } }) as MediaRecord | null
          : null
      }
    }
  } catch { /* prisma not available */ }

  return meta
}
