import type { MiddlewareHandler } from '@rudderjs/core'
import type { RouterLike } from './types.js'
import type { Panel } from '../Panel.js'
import type { Global } from '../Global.js'
import type { Resource } from '../Resource.js'
import { buildContext, coerceGlobalPayload, validatePayload } from './utils.js'

// ── Minimal structural types for dynamically-resolved dependencies ──

interface AppContainer {
  make(key: string): unknown
}

interface PrismaGlobalClient {
  panelGlobal: {
    findUnique(args: { where: Record<string, unknown> }): Promise<{ data: unknown } | null>
    upsert(args: {
      where:  Record<string, unknown>
      update: Record<string, unknown>
      create: Record<string, unknown>
    }): Promise<void>
  }
}

export function mountGlobalRoutes(
  router: RouterLike,
  panel: Panel,
  GlobalClass: typeof Global,
  mw: MiddlewareHandler[],
): void {
  const slug = GlobalClass.getSlug()
  const base = `${panel.getApiBase()}/_globals/${slug}`

  // GET /{panel}/api/_globals/{slug} — read global data
  router.get(base, async (req, res) => {
    const global = new GlobalClass()
    const ctx    = buildContext(req)
    if (!await global.policy('view', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    try {
      const { app } = await import(/* @vite-ignore */ '@rudderjs/core') as { app(): AppContainer }
      const prisma = app().make('prisma') as PrismaGlobalClient
      const row    = await prisma.panelGlobal.findUnique({ where: { slug } })
      const data   = row?.data ? (typeof row.data === 'string' ? JSON.parse(row.data as string) : row.data) : {}
      return res.json({ data })
    } catch {
      return res.json({ data: {} })
    }
  }, mw)

  // PUT /{panel}/api/_globals/{slug} — update global data
  router.put(base, async (req, res) => {
    const global = new GlobalClass()
    const ctx    = buildContext(req)
    if (!await global.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const raw    = req.body as Record<string, unknown>
    const body   = coerceGlobalPayload(global, raw)
    const errors = await validatePayload(global as unknown as Resource, body, 'update')
    if (errors) return res.status(422).json({ message: 'Validation failed.', errors })

    try {
      const { app } = await import(/* @vite-ignore */ '@rudderjs/core') as { app(): AppContainer }
      const prisma = app().make('prisma') as PrismaGlobalClient
      const serialized = JSON.stringify(body)
      await prisma.panelGlobal.upsert({
        where:  { slug },
        update: { data: serialized },
        create: { slug, data: serialized },
      })
      return res.json({ message: 'Saved.', data: body })
    } catch (err) {
      return res.status(500).json({ message: 'Failed to save.', error: String(err) })
    }
  }, mw)
}
