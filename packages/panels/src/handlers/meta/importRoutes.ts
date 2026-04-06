import type { MiddlewareHandler, AppRequest, AppResponse } from '@rudderjs/core'
import type { RouterLike } from '../types.js'
import type { Panel } from '../../Panel.js'
import type { Resource } from '../../Resource.js'
import type { ModelClass, RecordRow } from '../../types.js'
import type { Import } from '../../schema/Import.js'
import { buildContext } from '../shared/context.js'

/**
 * Parse CSV text into an array of records.
 * Handles quoted fields, commas inside quotes, and escaped quotes.
 */
function parseCSV(text: string): Record<string, unknown>[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  const parseRow = (line: string): string[] => {
    const fields: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"'
          i++
        } else if (ch === '"') {
          inQuotes = false
        } else {
          current += ch
        }
      } else {
        if (ch === '"') {
          inQuotes = true
        } else if (ch === ',') {
          fields.push(current.trim())
          current = ''
        } else {
          current += ch
        }
      }
    }
    fields.push(current.trim())
    return fields
  }

  const headers = parseRow(lines[0]!)
  return lines.slice(1).map(line => {
    const values = parseRow(line)
    const row: Record<string, unknown> = {}
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]!] = values[i] ?? ''
    }
    return row
  })
}

/**
 * Map import rows using column definitions.
 */
function mapColumns(
  rows: Record<string, unknown>[],
  importConfig: Import,
): Record<string, unknown>[] {
  const columns = importConfig.getColumns()
  if (columns.length === 0) return rows

  return rows.map(row => {
    const mapped: Record<string, unknown> = {}
    for (const col of columns) {
      const target = col.target ?? col.source
      // Case-insensitive source matching
      const sourceKey = Object.keys(row).find(k => k.toLowerCase() === col.source.toLowerCase())
      if (sourceKey) {
        mapped[target] = row[sourceKey]
      }
    }
    return mapped
  })
}

export function mountImportRoutes(
  router: RouterLike,
  panel: Panel,
  ResourceClass: typeof Resource,
  mw: MiddlewareHandler[],
): void {
  const slug = ResourceClass.getSlug()
  const base = `${panel.getApiBase()}/${slug}`
  const Model = ResourceClass.model as ModelClass<RecordRow> | undefined

  router.post(`${base}/_import`, async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx = buildContext(req)
    if (!await resource.policy('create', ctx)) return res.status(403).json({ message: 'Forbidden.' })
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const table = resource._resolveTable()
    const config = table.getConfig()
    const importConfig = config.importConfig
    if (!importConfig) return res.status(400).json({ message: 'Import not enabled for this resource.' })

    // Parse the body — expects { data: string, format: 'csv' | 'json' }
    const body = req.body as { data?: string; format?: 'csv' | 'json'; rows?: Record<string, unknown>[] }
    const format = body.format ?? 'csv'

    let rows: Record<string, unknown>[]

    if (body.rows) {
      // Pre-parsed rows (from client-side parsing or JSON upload)
      rows = body.rows
    } else if (body.data) {
      if (format === 'json') {
        try {
          const parsed = JSON.parse(body.data)
          rows = Array.isArray(parsed) ? parsed : [parsed]
        } catch {
          return res.status(422).json({ message: 'Invalid JSON data.' })
        }
      } else {
        rows = parseCSV(body.data)
      }
    } else {
      return res.status(422).json({ message: 'No data provided. Send "data" (raw text) or "rows" (parsed array).' })
    }

    if (rows.length === 0) {
      return res.status(422).json({ message: 'No rows found in import data.' })
    }

    // Apply column mapping
    rows = mapColumns(rows, importConfig)

    // Apply transform
    const transformFn = importConfig.getTransformFn()
    if (transformFn) {
      rows = rows.map(transformFn)
    }

    // Validate rows
    const validateFn = importConfig.getValidateFn()
    const errors: Array<{ row: number; error: string }> = []

    if (validateFn) {
      for (let i = 0; i < rows.length; i++) {
        const result = validateFn(rows[i]!)
        if (result !== true) {
          errors.push({ row: i + 1, error: result })
        }
      }
    }

    if (errors.length > 0) {
      return res.status(422).json({
        message: `Validation failed for ${errors.length} row(s).`,
        errors,
        total: rows.length,
      })
    }

    // Insert in chunks
    const chunkSize = importConfig.getChunkSize()
    let imported = 0

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize)
      for (const row of chunk) {
        try {
          await Model.create(row)
          imported++
        } catch {
          errors.push({ row: i + imported + 1, error: 'Insert failed' })
        }
      }
    }

    return res.json({
      message: `Imported ${imported} of ${rows.length} record(s).`,
      imported,
      total: rows.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  }, mw)
}
