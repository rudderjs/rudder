import { toTitleCase } from './utils.js'

export interface ImportColumnMapping {
  /** CSV/JSON field name. */
  source: string
  /** Model column name (defaults to source). */
  target?: string
  /** Display label for the mapping UI. */
  label?: string
}

export interface ImportMeta {
  enabled:    boolean
  formats:    ('csv' | 'json')[]
  chunkSize:  number
  columns?:   ImportColumnMapping[]
}

/**
 * Configure data import for a resource.
 *
 * @example
 * table(table) {
 *   return table
 *     .importable(
 *       Import.make()
 *         .formats(['csv', 'json'])
 *         .columns([
 *           { source: 'Name', target: 'name' },
 *           { source: 'Email', target: 'email' },
 *         ])
 *         .chunkSize(100)
 *         .validate((row) => {
 *           if (!row.email) return 'Email is required'
 *           return true
 *         })
 *         .transform((row) => ({
 *           ...row,
 *           email: row.email.toLowerCase(),
 *         }))
 *     )
 * }
 */
export class Import {
  protected _formats:    ('csv' | 'json')[] = ['csv', 'json']
  protected _chunkSize   = 100
  protected _columns:    ImportColumnMapping[] = []
  protected _validateFn?: (row: Record<string, unknown>) => true | string
  protected _transformFn?: (row: Record<string, unknown>) => Record<string, unknown>

  static make(): Import {
    return new Import()
  }

  /** Allowed import formats (default: csv, json). */
  formats(formats: ('csv' | 'json')[]): this {
    this._formats = formats
    return this
  }

  /** Number of rows to insert per batch (default: 100). */
  chunkSize(size: number): this {
    this._chunkSize = size
    return this
  }

  /**
   * Define column mappings from import file to model fields.
   * If not set, columns are matched by name (case-insensitive).
   */
  columns(columns: ImportColumnMapping[]): this {
    this._columns = columns
    return this
  }

  /** Per-row validation. Return true if valid, or an error string. */
  validate(fn: (row: Record<string, unknown>) => true | string): this {
    this._validateFn = fn
    return this
  }

  /** Transform each row before insertion. */
  transform(fn: (row: Record<string, unknown>) => Record<string, unknown>): this {
    this._transformFn = fn
    return this
  }

  // ── Getters ────────────────────────────────────────────

  getFormats():    ('csv' | 'json')[] { return this._formats }
  getChunkSize():  number { return this._chunkSize }
  getColumns():    ImportColumnMapping[] { return this._columns }
  getValidateFn(): ((row: Record<string, unknown>) => true | string) | undefined { return this._validateFn }
  getTransformFn(): ((row: Record<string, unknown>) => Record<string, unknown>) | undefined { return this._transformFn }

  toMeta(): ImportMeta {
    const meta: ImportMeta = {
      enabled:   true,
      formats:   this._formats,
      chunkSize: this._chunkSize,
    }
    if (this._columns.length > 0) meta.columns = this._columns
    return meta
  }
}
