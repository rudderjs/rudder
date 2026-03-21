import type { MiddlewareHandler } from '@boostkit/core'
import type { RouterLike } from '../types.js'
import type { Panel } from '../../Panel.js'
import { FormRegistry } from '../../registries/FormRegistry.js'
import { ComputeRegistry } from '../../registries/ComputeRegistry.js'
import { warmUpRegistries, debugWarn, buildContext } from './shared.js'

export function mountFormRoutes(
  router: RouterLike,
  panel: Panel,
  mw: MiddlewareHandler[],
): void {
  const apiBase = panel.getApiBase()

  // Form field compute endpoint — recompute a field value from dependencies
  router.post(`${apiBase}/_forms/:formId/compute/:fieldName`, async (req, res) => {
    const formId = (req.params as Record<string, string> | undefined)?.['formId']
    const fieldName = (req.params as Record<string, string> | undefined)?.['fieldName']
    if (!formId || !fieldName) return res.status(400).json({ message: 'Missing formId or fieldName.' })

    let entry = ComputeRegistry.get(panel.getName(), `${formId}:${fieldName}`)
    if (!entry) {
      try { await warmUpRegistries(panel, req) } catch (e) { debugWarn('registry.warmup', e) }
      entry = ComputeRegistry.get(panel.getName(), `${formId}:${fieldName}`)
    }
    if (!entry) return res.status(404).json({ message: `Compute field "${fieldName}" not found.` })

    const values = (req.body as Record<string, unknown> | undefined) ?? {}
    try {
      const result = entry.compute(values)
      return res.json({ value: result })
    } catch (err) {
      return res.status(422).json({ message: String(err) })
    }
  }, mw)

  // Form field persist endpoint — save field value to session (persist='session' mode)
  router.post(`${apiBase}/_forms/:formId/persist`, async (req, res) => {
    const formId = (req.params as Record<string, string> | undefined)?.['formId']
    if (!formId) return res.status(400).json({ message: 'Missing formId.' })

    const { field, value } = (req.body as { field?: string; value?: unknown }) ?? {}
    if (!field) return res.status(400).json({ message: 'Missing field name.' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = (req as any).session as { put(key: string, value: unknown): void } | undefined
    if (session) {
      session.put(`form:${formId}:${field}`, value)
    }

    return res.json({ success: true })
  }, mw)

  router.post(`${apiBase}/_forms/:formId/submit`, async (req, res) => {
    const formId = (req.params as Record<string, string> | undefined)?.['formId']
    if (!formId) return res.status(400).json({ message: 'Missing formId.' })

    // Look up registered entry (populated when the page containing the form is SSR'd)
    let entry = FormRegistry.getEntry(panel.getName(), formId)
    if (!entry) {
      // Entry not yet registered — try to warm up by evaluating the schema
      try {
        await warmUpRegistries(panel, req)
      } catch (e) { debugWarn('registry.warmup', e) }
      entry = FormRegistry.getEntry(panel.getName(), formId)
    }

    if (!entry) return res.status(404).json({ message: `Form "${formId}" not found.` })

    let data = (req.body as Record<string, unknown> | undefined) ?? {}
    const ctx = buildContext(req)

    try {
      // Before hook — transform data before submission
      if (entry.beforeSubmit) {
        data = await entry.beforeSubmit(data, ctx)
      }

      // Main handler
      const result = await entry.handler(data, ctx)
      const responseData = typeof result === 'object' && result !== null ? result : {}

      // After hook — run after successful submission
      if (entry.afterSubmit) {
        await entry.afterSubmit(responseData, ctx)
      }

      // Broadcast live refresh to linked tables
      if (entry.refreshes && entry.refreshes.length > 0) {
        try {
          const broadcastPkg = '@boostkit/broadcast'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { broadcast } = await import(/* @vite-ignore */ broadcastPkg) as any
          for (const tableId of entry.refreshes) {
            const slug = tableId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
            broadcast(`live:table:${slug}`, 'refresh', { source: 'form', formId })
          }
        } catch { /* @boostkit/broadcast not available */ }
      }

      return res.json({ success: true, ...responseData })
    } catch (err: unknown) {
      return res.status(422).json({ message: String(err) })
    }
  }, mw)
}
