import type { MiddlewareHandler } from '@rudderjs/core'
import type { RouterLike } from '../types.js'
import type { Panel } from '../../Panel.js'
import { importImage } from './shared.js'

export function mountUploadRoutes(
  router: RouterLike,
  panel: Panel,
  mw: MiddlewareHandler[],
): void {
  const apiBase = panel.getApiBase()

  // Upload endpoint — used by FileField / ImageField
  router.post(`${apiBase}/_upload`, async (req, res) => {
    try {
      const { Storage } = await import(/* @vite-ignore */ '@rudderjs/storage')
      // req.raw is the Hono Context (c); c.req.parseBody() parses multipart/form-data
      const body = await ((req.raw as Record<string, unknown>)['req'] as { parseBody(): Promise<Record<string, unknown>> }).parseBody()
      const file      = body['file'] as File
      const disk      = String(body['disk']      ?? 'local')
      const directory = String(body['directory'] ?? 'uploads')
      const optimize  = body['optimize'] === 'true' || body['optimize'] === true
      const rawConversions = body['conversions'] as string | undefined

      let buffer = Buffer.from(await file.arrayBuffer())
      const isImage = file.type.startsWith('image/') && !file.type.includes('svg')

      // Determine output extension
      let ext = (file.name.split('.').pop() ?? 'bin').toLowerCase()

      // Optimize image (strip metadata, convert to webp, good quality)
      if (isImage && optimize) {
        try {
          const { image } = await importImage()
          buffer = await image(buffer).optimize().format('webp').quality(85).toBuffer()
          ext = 'webp'
        } catch { /* @rudderjs/image not installed — skip */ }
      }

      const baseName = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const filename = `${baseName}.${ext}`
      const path     = `${directory}/${filename}`

      await Storage.disk(disk).put(path, buffer)
      const url = Storage.disk(disk).url(path)

      // Generate conversions
      const conversions: Array<{ name: string; path: string; url: string }> = []
      if (isImage && rawConversions) {
        try {
          const specs = JSON.parse(rawConversions) as Array<{ name: string; width: number; height?: number; crop?: boolean; format?: string; quality?: number }>
          if (specs.length > 0) {
            const { image } = await importImage()
            for (const spec of specs) {
              const convFormat = spec.format ?? 'webp'
              const convFilename = `${baseName}-${spec.name}.${convFormat}`
              const convPath = `${directory}/${convFilename}`

              let proc = image(buffer).resize(spec.width, spec.height)
              if (spec.crop) proc = proc.fit('cover')
              proc = proc.format(convFormat as 'webp').stripMetadata()
              if (spec.quality) proc = proc.quality(spec.quality)

              const convBuffer = await proc.toBuffer()
              await Storage.disk(disk).put(convPath, convBuffer)

              conversions.push({
                name: spec.name,
                path: convPath,
                url:  Storage.disk(disk).url(convPath),
              })
            }
          }
        } catch { /* conversions failed — return original only */ }
      }

      return res.json({ url, path, conversions })
    } catch (err) {
      return res.status(500).json({ message: 'Upload failed.', error: String(err) })
    }
  }, mw)
}
