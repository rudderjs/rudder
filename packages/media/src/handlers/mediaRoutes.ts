import type { MiddlewareHandler, AppRequest, AppResponse } from '@boostkit/core'
import type { MediaRecord, ConversionInfo, MediaConversion } from '../types.js'

interface RouterLike {
  get(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
  post(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
  put(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
  delete(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
}

type PrismaModel = {
  findMany(args: Record<string, unknown>): Promise<unknown[]>
  findUnique(args: Record<string, unknown>): Promise<unknown | null>
  create(args: Record<string, unknown>): Promise<unknown>
  update(args: Record<string, unknown>): Promise<unknown>
  delete(args: Record<string, unknown>): Promise<unknown>
  count(args?: Record<string, unknown>): Promise<number>
}

async function getPrisma(): Promise<{ media: PrismaModel }> {
  const { resolve } = await import(/* @vite-ignore */ '@boostkit/core')
  return resolve<{ media: PrismaModel }>('prisma')
}

async function getStorage(): Promise<{ disk(name: string): { put(path: string, contents: Buffer | string): Promise<void>; delete(path: string): Promise<void>; url(path: string): string } }> {
  const { Storage } = await import(/* @vite-ignore */ '@boostkit/storage')
  return Storage as unknown as { disk(name: string): { put(path: string, contents: Buffer | string): Promise<void>; delete(path: string): Promise<void>; url(path: string): string } }
}

function param(req: AppRequest, name: string): string {
  return (req.params as Record<string, string | undefined>)[name] ?? ''
}

function query(req: AppRequest): Record<string, string> {
  const url = new URL(req.url, 'http://localhost')
  const out: Record<string, string> = {}
  url.searchParams.forEach((v, k) => { out[k] = v })
  return out
}

export function mountMediaRoutes(
  router: RouterLike,
  panelApiBase: string,
  mw: MiddlewareHandler[],
): void {
  const base = `${panelApiBase}/media`

  // ── GET /panel/api/media — list items in a folder ─────────
  router.get(base, async (req, res) => {
    const prisma = await getPrisma()
    const q = query(req)
    const parentId = q['parentId'] || null
    const scope = q['scope'] === 'private' ? 'private' : 'shared'
    const search = q['search'] ?? ''

    const where: Record<string, unknown> = {
      parentId: parentId,
      scope,
    }

    // For private scope, filter by userId
    if (scope === 'private' && q['userId']) {
      where['userId'] = q['userId']
    }

    // Search by name
    if (search) {
      where['name'] = { contains: search, mode: 'insensitive' }
    }

    const items = await prisma.media.findMany({
      where,
      orderBy: [
        { type: 'asc' },  // folders first
        { name: 'asc' },
      ],
    }) as MediaRecord[]

    // Build breadcrumbs by walking up the tree
    const breadcrumbs: Array<{ id: string; name: string }> = []
    if (parentId) {
      let current = await prisma.media.findUnique({ where: { id: parentId } }) as MediaRecord | null
      while (current) {
        breadcrumbs.unshift({ id: current.id, name: current.name })
        current = current.parentId
          ? await prisma.media.findUnique({ where: { id: current.parentId } }) as MediaRecord | null
          : null
      }
    }

    res.json({ items, breadcrumbs })
  }, mw)

  // ── GET /panel/api/media/:id — single item ───────────────
  router.get(`${base}/:id`, async (req, res) => {
    const prisma = await getPrisma()
    const item = await prisma.media.findUnique({ where: { id: param(req, 'id') } }) as MediaRecord | null
    if (!item) return res.status(404).json({ message: 'Not found.' })
    res.json({ item })
  }, mw)

  // ── POST /panel/api/media/folder — create folder ──────────
  router.post(`${base}/folder`, async (req, res) => {
    const prisma = await getPrisma()
    const body = req.body as Record<string, unknown> | null
    const name = String(body?.['name'] ?? '').trim()
    if (!name) return res.status(422).json({ message: 'Folder name is required.' })

    const folder = await prisma.media.create({
      data: {
        name,
        type: 'folder',
        parentId: (body?.['parentId'] as string) || null,
        scope: (body?.['scope'] as string) || 'shared',
        userId: (body?.['userId'] as string) || null,
      },
    })

    res.status(201).json({ item: folder })
  }, mw)

  // ── POST /panel/api/media/upload — upload file(s) ─────────
  router.post(`${base}/upload`, async (req, res) => {
    const prisma = await getPrisma()
    const Storage = await getStorage()
    const raw = (req.raw as Record<string, unknown>)?.['req'] as Record<string, (...args: unknown[]) => unknown> | undefined

    // Parse multipart body (Hono)
    let formData: Record<string, unknown>
    if (raw?.['parseBody']) {
      formData = await raw['parseBody']({ all: true }) as Record<string, unknown>
    } else {
      return res.status(400).json({ message: 'Multipart upload required.' })
    }

    const parentId = (formData['parentId'] as string) || null
    const scope = (formData['scope'] as string) || 'shared'
    const userId = (formData['userId'] as string) || null

    // Element-level config (sent from Media.make() via frontend)
    const disk = (formData['disk'] as string) || 'public'
    const baseDir = (formData['directory'] as string) || 'media'
    const maxSize = Number(formData['maxUploadSize']) || 10 * 1024 * 1024
    let uploadConversions: MediaConversion[] = []
    try {
      const raw = formData['conversions'] as string | undefined
      if (raw) uploadConversions = JSON.parse(raw) as MediaConversion[]
    } catch { /* ignore */ }

    // Collect files (single or multiple)
    const rawFiles = formData['file'] ?? formData['files']
    const files: Array<{ name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }> = []

    if (Array.isArray(rawFiles)) {
      for (const f of rawFiles) {
        if (f && typeof f === 'object' && 'arrayBuffer' in f) files.push(f as typeof files[0])
      }
    } else if (rawFiles && typeof rawFiles === 'object' && 'arrayBuffer' in rawFiles) {
      files.push(rawFiles as typeof files[0])
    }

    if (files.length === 0) return res.status(422).json({ message: 'No files provided.' })

    const results: unknown[] = []

    for (const file of files) {
      if (file.size > maxSize) {
        results.push({ error: `File "${file.name}" exceeds max size (${Math.round(maxSize / 1024 / 1024)}MB).` })
        continue
      }

      // Read file buffer
      const buffer = Buffer.from(await file.arrayBuffer())

      // Create the media record first to get the ID
      const record = await prisma.media.create({
        data: {
          name: file.name,
          type: 'file',
          mime: file.type,
          size: file.size,
          disk,
          parentId,
          scope,
          userId,
        },
      }) as MediaRecord

      // Store the file
      const dir = `${baseDir}/${record.id}`
      const ext = file.name.split('.').pop() ?? 'bin'
      const storedFilename = `original.${ext}`
      await Storage.disk(disk).put(`${dir}/${storedFilename}`, buffer)

      // Image metadata + conversions
      let width: number | null = null
      let height: number | null = null
      let conversions: ConversionInfo[] = []

      if (file.type.startsWith('image/') && !file.type.includes('svg')) {
        try {
          const { image } = await import(/* @vite-ignore */ '@boostkit/image')
          const meta = await image(buffer).metadata()
          width = meta.width ?? null
          height = meta.height ?? null

          // Generate conversions
          if (uploadConversions.length > 0) {
            const specs = uploadConversions.map((c: MediaConversion) => {
              const spec: Record<string, unknown> = { name: c.name, width: c.width }
              if (c.height !== undefined)  spec['height']  = c.height
              if (c.crop !== undefined)    spec['crop']    = c.crop
              if (c.format !== undefined)  spec['format']  = c.format
              if (c.quality !== undefined) spec['quality'] = c.quality
              return spec
            })
            const convResults = await image(buffer)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .conversions(specs as any)
              .generateToStorage(disk, dir)

            conversions = convResults.map((r) => ({
              name: r.name,
              filename: r.path.split('/').pop() ?? '',
              width: r.width,
              height: r.height,
              size: r.size,
              format: r.format,
            }))
          }
        } catch {
          // @boostkit/image not installed or processing failed — skip
        }
      }

      // Update record with storage info
      const updated = await prisma.media.update({
        where: { id: record.id },
        data: {
          directory: dir,
          filename: storedFilename,
          width,
          height,
          conversions: JSON.stringify(conversions),
        },
      })

      results.push(updated)
    }

    res.status(201).json({ items: results })
  }, mw)

  // ── PUT /panel/api/media/:id — update (rename, move, alt) ─
  router.put(`${base}/:id`, async (req, res) => {
    const prisma = await getPrisma()
    const body = req.body as Record<string, unknown> | null
    const id = param(req, 'id')

    const existing = await prisma.media.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ message: 'Not found.' })

    const data: Record<string, unknown> = {}
    if (body?.['name'] !== undefined)     data['name']     = String(body['name'])
    if (body?.['alt'] !== undefined)      data['alt']      = String(body['alt'])
    if (body?.['parentId'] !== undefined) data['parentId'] = (body['parentId'] as string) || null
    if (body?.['focalX'] !== undefined)   data['focalX']   = Number(body['focalX'])
    if (body?.['focalY'] !== undefined)   data['focalY']   = Number(body['focalY'])
    if (body?.['meta'] !== undefined)     data['meta']     = body['meta']

    const updated = await prisma.media.update({ where: { id }, data })
    res.json({ item: updated })
  }, mw)

  // ── DELETE /panel/api/media/:id — delete ──────────────────
  router.delete(`${base}/:id`, async (req, res) => {
    const prisma = await getPrisma()
    const Storage = await getStorage()
    const id = param(req, 'id')

    const item = await prisma.media.findUnique({ where: { id } }) as MediaRecord | null
    if (!item) return res.status(404).json({ message: 'Not found.' })

    // If folder, check for children
    if (item.type === 'folder') {
      const childCount = await prisma.media.count({ where: { parentId: id } })
      if (childCount > 0) {
        return res.status(422).json({ message: 'Folder is not empty. Delete its contents first.' })
      }
    }

    // Delete files from storage + remove the directory
    if (item.type === 'file' && item.directory && item.filename) {
      try {
        const storageDisk = Storage.disk(item.disk)
        await storageDisk.delete(`${item.directory}/${item.filename}`)
        // Delete conversions
        const convs = (typeof item.conversions === 'string' ? JSON.parse(item.conversions) : item.conversions) as ConversionInfo[]
        for (const conv of convs) {
          try { await storageDisk.delete(`${item.directory}/${conv.filename}`) } catch { /* ignore */ }
        }
        // Remove the now-empty directory
        try {
          const { rm } = await import('node:fs/promises')
          const dirPath = (storageDisk as { path?(p: string): string }).path?.(item.directory)
            ?? item.directory
          await rm(dirPath, { recursive: true, force: true })
        } catch { /* ignore — directory may not exist or not be empty */ }
      } catch { /* storage cleanup is best-effort */ }
    }

    await prisma.media.delete({ where: { id } })
    res.status(204).send('')
  }, mw)

  // ── GET /panel/api/media/:id/url — get file URL ──────────
  router.get(`${base}/:id/url`, async (req, res) => {
    const prisma = await getPrisma()
    const Storage = await getStorage()
    const id = param(req, 'id')
    const q = query(req)
    const conversion = q['conversion']

    const item = await prisma.media.findUnique({ where: { id } }) as MediaRecord | null
    if (!item || item.type === 'folder') return res.status(404).json({ message: 'Not found.' })

    let filePath = `${item.directory}/${item.filename}`

    if (conversion) {
      const convs = (typeof item.conversions === 'string' ? JSON.parse(item.conversions) : item.conversions) as ConversionInfo[]
      const conv = convs.find((c) => c.name === conversion)
      if (conv) filePath = `${item.directory}/${conv.filename}`
    }

    const url = Storage.disk(item.disk).url(filePath)
    res.json({ url })
  }, mw)

  // ── POST /panel/api/media/:id/move — move to folder ──────
  router.post(`${base}/:id/move`, async (req, res) => {
    const prisma = await getPrisma()
    const body = req.body as Record<string, unknown> | null
    const id = param(req, 'id')
    const targetParentId = (body?.['parentId'] as string) || null

    // Prevent moving a folder into itself or its children
    if (targetParentId) {
      let check = targetParentId
      while (check) {
        if (check === id) return res.status(422).json({ message: 'Cannot move a folder into itself.' })
        const parent = await prisma.media.findUnique({ where: { id: check } }) as MediaRecord | null
        check = parent?.parentId ?? ''
      }
    }

    const updated = await prisma.media.update({
      where: { id },
      data: { parentId: targetParentId },
    })

    res.json({ item: updated })
  }, mw)
}
