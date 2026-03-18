import type { Column, ColumnMeta } from './Column.js'

// ─── Table schema element ────────────────────────────────────
// Two modes:
//
// Mode 1 — Resource-linked (existing, unchanged):
//   Table.make('Recent Articles')
//     .resource('articles')       // slug of a registered panel Resource
//     .columns(['title', 'createdAt'])
//     .limit(5)
//
// Mode 2 — Model-backed (new):
//   Table.make('Users')
//     .fromModel(User)            // ORM Model class directly
//     .columns([
//       Column.make('name').label('Name').sortable().searchable(),
//       Column.make('email').label('Email').sortable(),
//     ])
//     .limit(10)
//     .reorderable('position')    // drag-to-reorder, saves to position field

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelClass = { new(): any; query(): any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResourceClass = { new(): any; getSlug(): string; model?: ModelClass }

export interface PanelColumnMeta {
  name:       string
  label:      string
  sortable?:  boolean
  searchable?: boolean
  type?:      ColumnMeta['type']
  format?:    string
  href?:      string
}

export interface TableElementMeta {
  type:         'table'
  title:        string
  resource:     string
  columns:      PanelColumnMeta[]
  records:      unknown[]
  href:         string
  reorderable?: boolean
  reorderEndpoint?: string
}

export interface TableConfig {
  title:        string
  resource:     string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?:       any                  // direct model class (model-backed mode)
  columns:      string[] | Column[]
  limit:        number
  sortBy:       string | undefined
  sortDir:      'ASC' | 'DESC'
  reorderable:  boolean
  reorderField: string
}

export class Table {
  private _title:        string
  private _resource?:    string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _model?:       any
  private _columns:      string[] | Column[] = []
  private _limit:        number              = 5
  private _sortBy?:      string
  private _sortDir:      'ASC' | 'DESC'      = 'DESC'
  private _reorderable:  boolean             = false
  private _reorderField: string              = 'position'

  protected constructor(title: string) {
    this._title = title
  }

  static make(title: string): Table {
    return new Table(title)
  }

  // ── Mode 1: resource-linked (existing) ─────────────────

  /** Link to a registered panel Resource by its slug. */
  resource(slug: string): this {
    this._resource = slug
    return this
  }

  // ── Mode 2: model-backed (new) ──────────────────────────

  /**
   * Use an ORM Model class directly as the data source.
   * Define display columns with Column.make().
   *
   * @example
   * Table.make('Users')
   *   .fromModel(User)
   *   .columns([Column.make('name').sortable(), Column.make('email')])
   */
  fromModel(model: ModelClass): this {
    this._model = model
    return this
  }

  /**
   * Use a Resource class as the data source (reuses its model + field definitions).
   *
   * @example
   * Table.make('Recent Articles')
   *   .fromResource(ArticleResource)
   *   .columns([Column.make('title').sortable(), Column.make('createdAt').date()])
   */
  fromResource(resourceClass: ResourceClass): this {
    this._model = resourceClass.model
    return this
  }

  // ── Shared ──────────────────────────────────────────────

  /** Accept string column names (existing) or Column instances (new). */
  columns(cols: string[] | Column[]): this {
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

  /**
   * Enable drag-to-reorder rows.
   * Saves the new order to `positionField` (default: 'position') via the panel API.
   * Requires a numeric position column on the model's table.
   */
  reorderable(positionField = 'position'): this {
    this._reorderable  = true
    this._reorderField = positionField
    return this
  }

  getType(): 'table' { return 'table' }

  getConfig(): TableConfig {
    return {
      title:        this._title,
      resource:     this._resource,
      model:        this._model,
      columns:      this._columns,
      limit:        this._limit,
      sortBy:       this._sortBy,
      sortDir:      this._sortDir,
      reorderable:  this._reorderable,
      reorderField: this._reorderField,
    }
  }
}
