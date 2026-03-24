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

export async function resolveMedia(el: unknown): Promise<MediaElementMeta> {
  const media = el as Media
  const meta = media.toMeta()
  const dataFn = media.getDataFn()

  if (media.isLazy()) {
    return meta
  }

  if (dataFn) {
    // Custom data function — let the user provide items
    try {
      const result = await dataFn({ req: null, panelPath: '', pathSegment: '' } as never)
      meta.items = result.items
      meta.breadcrumbs = result.breadcrumbs
      meta.currentFolder = result.currentFolder
    } catch { /* fallback to empty */ }
    return meta
  }

  // Default: load from Prisma
  try {
    const prisma = await getPrisma()
    const parentId = media.getParentId()

    const where: Record<string, unknown> = {
      parentId,
      scope: media.getScope(),
    }

    const items = await prisma.media.findMany({
      where,
      orderBy: [
        { type: 'asc' },
        { name: 'asc' },
      ],
    }) as MediaRecord[]

    meta.items = items

    // Build breadcrumbs
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
  } catch { /* prisma not available — return empty */ }

  return meta
}
