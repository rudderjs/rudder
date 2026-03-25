import type { Media, MediaElementMeta } from './schema/Media.js'
import type { MediaRecord } from './types.js'

interface PrismaMedia {
  findMany(args: Record<string, unknown>): Promise<unknown[]>
  findUnique(args: Record<string, unknown>): Promise<unknown | null>
}

async function getPrisma(): Promise<{ media: PrismaMedia }> {
  const { resolve } = await import(/* @vite-ignore */ '@boostkit/core')
  return resolve<{ media: PrismaMedia }>('prisma')
}

/**
 * SSR resolver for Media.make() schema element.
 *
 * - Default (lazy): returns empty meta, client fetches on mount
 * - `.ssr()`: pre-loads items from DB filtered by active library
 */
export async function resolveMedia(el: unknown): Promise<MediaElementMeta> {
  const media = el as Media
  const meta = media.toMeta()

  // Lazy mode (default) — no SSR data, client fetches on mount
  if (!media.isSsr()) return meta

  // SSR mode — pre-load items
  try {
    const prisma = await getPrisma()
    const parentId = media.getParentId()
    const activeLib = media.getActiveLibrary()

    const where: Record<string, unknown> = {
      parentId,
      scope: media.getScope(),
    }

    if (activeLib.directory) {
      where['directory'] = { startsWith: activeLib.directory }
    }

    meta.items = await prisma.media.findMany({
      where,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }) as MediaRecord[]

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
