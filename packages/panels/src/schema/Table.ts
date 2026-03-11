// ─── Table schema element ───────────────────────────────────
// Resolved server-side by resolveSchema() — records are populated at SSR time.

export interface PanelColumnMeta {
  name:  string
  label: string
}

export interface TableElementMeta {
  type:     'table'
  title:    string
  resource: string
  columns:  PanelColumnMeta[]
  records:  unknown[]
  href:     string
}

export interface TableConfig {
  title:    string
  resource: string | undefined
  columns:  string[]
  limit:    number
  sortBy:   string | undefined
  sortDir:  'ASC' | 'DESC'
}

export class Table {
  private _title:    string
  private _resource?: string
  private _columns:  string[]       = []
  private _limit:    number         = 5
  private _sortBy?:  string
  private _sortDir:  'ASC' | 'DESC' = 'DESC'

  protected constructor(title: string) {
    this._title = title
  }

  static make(title: string): Table {
    return new Table(title)
  }

  resource(slug: string): this {
    this._resource = slug
    return this
  }

  columns(cols: string[]): this {
    this._columns = cols
    return this
  }

  limit(n: number): this {
    this._limit = n
    return this
  }

  sortBy(col: string, dir: 'ASC' | 'DESC' = 'DESC'): this {
    this._sortBy  = col
    this._sortDir = dir
    return this
  }

  getType(): 'table' { return 'table' }

  getConfig(): TableConfig {
    return {
      title:    this._title,
      resource: this._resource,
      columns:  this._columns,
      limit:    this._limit,
      sortBy:   this._sortBy,
      sortDir:  this._sortDir,
    }
  }
}
