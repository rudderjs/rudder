import type { MiddlewareHandler } from '@rudderjs/core'
import type { RouterLike } from '../types.js'
import type { Panel } from '../../Panel.js'
import { StatsRegistry } from '../../registries/StatsRegistry.js'
import { warmUpRegistries, debugWarn, buildContext } from './shared.js'

export function mountStatsRoutes(
  router: RouterLike,
  panel: Panel,
  mw: MiddlewareHandler[],
): void {
  const apiBase = panel.getApiBase()

  // Stats data endpoint — used by lazy/poll stats
  router.get(`${apiBase}/_stats/:statsId`, async (req, res) => {
    const statsId = (req.params as Record<string, string> | undefined)?.['statsId']
    if (!statsId) return res.status(400).json({ message: 'Missing statsId.' })

    let stats = StatsRegistry.get(panel.getName(), statsId)
    if (!stats) {
      // Warm up by evaluating schema
      try {
        await warmUpRegistries(panel, req)
      } catch (e) { debugWarn('registry.warmup', e) }
      stats = StatsRegistry.get(panel.getName(), statsId)
    }

    if (!stats) return res.status(404).json({ message: `Stats "${statsId}" not found.` })

    const dataFn = stats.getDataFn()
    if (!dataFn) {
      // Return static stats
      return res.json({ stats: stats.getStats().map(s => s.toMeta()) })
    }

    const ctx = buildContext(req)
    try {
      const resolved = await dataFn(ctx)
      return res.json({ stats: resolved })
    } catch (err) {
      return res.status(500).json({ message: String(err) })
    }
  }, mw)
}
