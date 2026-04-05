import type { MiddlewareHandler } from '@rudderjs/core'
import type { RouterLike } from './types.js'
import type { Panel } from '../Panel.js'
import type { PanelThemeConfig } from '../theme/types.js'
import { presets } from '../theme/presets.js'
import { baseColors } from '../theme/base-colors.js'
import { accentColors } from '../theme/accent-colors.js'
import { chartPalettes } from '../theme/chart-palettes.js'
import { radiusMap } from '../theme/radius.js'

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
    delete(args: { where: Record<string, unknown> }): Promise<void>
  }
}

function themeSlug(panel: Panel): string {
  return `${panel.getName()}__theme`
}

/** Load saved theme overrides from the database. */
export async function loadThemeOverrides(panel: Panel): Promise<Partial<PanelThemeConfig> | null> {
  try {
    const { app } = await import(/* @vite-ignore */ '@rudderjs/core') as { app(): AppContainer }
    const prisma = app().make('prisma') as PrismaGlobalClient
    const row = await prisma.panelGlobal.findUnique({ where: { slug: themeSlug(panel) } })
    if (!row?.data) return null
    const data = typeof row.data === 'string' ? JSON.parse(row.data as string) : row.data
    return data as Partial<PanelThemeConfig>
  } catch {
    return null
  }
}

export function mountThemeRoutes(
  router: RouterLike,
  panel: Panel,
  mw: MiddlewareHandler[],
): void {
  const base = `${panel.getApiBase()}/_theme`

  // GET /{panel}/api/_theme — returns config, overrides, and available options
  router.get(base, async (_req, res) => {
    const overrides = await loadThemeOverrides(panel)

    return res.json({
      config:    panel.getTheme() ?? {},
      overrides: overrides ?? {},
      options: {
        presets:       Object.keys(presets),
        baseColors:    Object.keys(baseColors),
        accentColors:  Object.keys(accentColors),
        chartPalettes: Object.keys(chartPalettes),
        radii:         Object.keys(radiusMap),
        iconLibraries: ['lucide', 'tabler', 'phosphor', 'remix'],
      },
    })
  }, mw)

  // PUT /{panel}/api/_theme — save theme overrides
  router.put(base, async (req, res) => {
    try {
      const overrides = req.body as Partial<PanelThemeConfig>

      const { app } = await import(/* @vite-ignore */ '@rudderjs/core') as { app(): AppContainer }
      const prisma = app().make('prisma') as PrismaGlobalClient
      const slug = themeSlug(panel)

      await prisma.panelGlobal.upsert({
        where:  { slug },
        update: { data: JSON.stringify(overrides) },
        create: { slug, data: JSON.stringify(overrides) },
      })

      // Update runtime overrides so next request picks them up
      panel.setThemeOverrides(overrides)

      return res.json({ ok: true })
    } catch (e) {
      return res.status(500).json({ message: e instanceof Error ? e.message : 'Failed to save theme' })
    }
  }, mw)

  // DELETE /{panel}/api/_theme — reset to code defaults
  router.delete(base, async (_req, res) => {
    try {
      const { app } = await import(/* @vite-ignore */ '@rudderjs/core') as { app(): AppContainer }
      const prisma = app().make('prisma') as PrismaGlobalClient
      await prisma.panelGlobal.delete({ where: { slug: themeSlug(panel) } }).catch(() => {})
      panel.setThemeOverrides(undefined)
      return res.json({ ok: true })
    } catch {
      return res.json({ ok: true })
    }
  }, mw)
}
