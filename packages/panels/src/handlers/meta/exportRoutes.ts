import type { MiddlewareHandler } from '@boostkit/core'
import type { RouterLike } from '../types.js'
import type { Panel } from '../../Panel.js'
import type { QueryBuilderLike, RecordRow } from '../../types.js'
import { TableRegistry } from '../../registries/TableRegistry.js'
import { warmUpRegistries, debugWarn, buildContext } from './shared.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelClass<T = any> = { query(): QueryBuilderLike<T> }

export function mountExportRoutes(
  router: RouterLike,
  panel: Panel,
  mw: MiddlewareHandler[],
): void {
  const apiBase = panel.getApiBase()

  // GET /_tables/:tableId/export?format=csv&search=&filter[name]=value
  router.get(`${apiBase}/_tables/:tableId/export`, async (req, res) => {
    const tableId = (req.params as Record<string, string> | undefined)?.['tableId']
    if (!tableId) return res.status(400).json({ message: 'Missing tableId.' })

    let table = TableRegistry.get(panel.getName(), tableId)
    if (!table) {
      try { await warmUpRegistries(panel, req) } catch (e) { debugWarn('registry.warmup', e) }
      table = TableRegistry.get(panel.getName(), tableId)
    }
    if (!table) return res.status(404).json({ message: `Table "${tableId}" not found.` })

    const config = table.getConfig()
    const url = new URL(req.url, 'http://localhost')
    const format = url.searchParams.get('format') ?? 'csv'
    const search = url.searchParams.get('search')?.trim() ?? ''

    // ── Resolve all records (no pagination — export full filtered dataset) ──

    let records: RecordRow[] = []

    if (config.rows) {
      // fromArray
      const { resolveDataSource: resolveDS } = await import('../../datasource.js')
      const ctx = buildContext(req)
      records = await resolveDS(config.rows, ctx) as RecordRow[]

      // Client-side search
      if (search && config.searchable) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cols = config.searchColumns ?? ((config.columns ?? []) as any[]).map((c: any) => typeof c === 'string' ? c : c.getName?.() ?? '')
        records = records.filter(row =>
          cols.some((col: string) => String(row[col] ?? '').toLowerCase().includes(search.toLowerCase()))
        )
      }
    } else if (config.model) {
      const Model = config.model as ModelClass<RecordRow>
      let q: QueryBuilderLike<RecordRow> = Model.query()
      if (config.scope) q = config.scope(q)

      // Apply search
      if (search && config.searchable) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const searchCols = config.searchColumns ?? ((config.columns ?? []) as any[])
          .filter((c: { toMeta?: () => { searchable?: boolean } }) => typeof c !== 'string' && c.toMeta?.()?.searchable)
          .map((c: { toMeta: () => { name: string } }) => c.toMeta().name)
        if (searchCols.length > 0) {
          q = q.where(searchCols[0] ?? '', 'LIKE', `%${search}%`)
          for (let i = 1; i < searchCols.length; i++) {
            q = q.orWhere(searchCols[i] ?? '', 'LIKE', `%${search}%`)
          }
        }
      }

      // Apply filters
      for (const [key, value] of url.searchParams.entries()) {
        const match = key.match(/^filter\[(.+)\]$/)
        if (match) {
          const filterName = match[1]
          const filter = config.filters.find(f => f.getName() === filterName)
          if (filter) q = filter.applyToQuery(q, value)
          else q = q.where(filterName ?? '', value)
        }
      }

      // Sort
      const sortCol = config.sortBy
      if (sortCol) q = q.orderBy(sortCol, config.sortDir)

      try { records = await q.get() } catch { /* empty */ }
    }

    if (records.length === 0) {
      return format === 'json'
        ? res.json([])
        : res.header('Content-Type', 'text/csv').send('No records')
    }

    // ── Determine columns for export ──
    // Use all keys from first record, or column names if available
    const keys = Object.keys(records[0] ?? {}).filter(k => k !== 'id')

    // ── Format and respond ──

    if (format === 'json') {
      res.header('Content-Disposition', `attachment; filename="${tableId}.json"`)
      return res.json(records)
    }

    // CSV
    const escape = (val: unknown): string => {
      const s = val === null || val === undefined ? '' : String(val)
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }

    const header = keys.map(escape).join(',')
    const rows = records.map(r => keys.map(k => escape(r[k])).join(','))
    const csv = [header, ...rows].join('\n')

    res.header('Content-Type', 'text/csv; charset=utf-8')
    res.header('Content-Disposition', `attachment; filename="${tableId}.csv"`)
    return res.send(csv)
  }, mw)
}
