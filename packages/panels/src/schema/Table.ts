import type { Column, ColumnMeta } from './Column.js'
import type { Filter, FilterMeta } from '../Filter.js'
import type { Action, ActionMeta, ActionHandler } from '../Action.js'

// ─── Table schema element ────────────────────────────────────
// Three modes:
//
//   Table.make('Recent Articles')       — resource-linked
//     .fromResource(ArticleResource)
//     .columns(['title', 'createdAt'])
//     .limit(5)
//
//   Table.make('All Users')             — model-backed
//     .fromModel(User)
//     .columns([Column.make('name').sortable().searchable()])
//     .limit(10)
//     .reorderable('position')
//
//   Table.make('Browsers')              — static rows
//     .rows([{ name: 'Chrome', share: 65 }, { name: 'Firefox', share: 10 }])
//     .columns([Column.make('name'), Column.make('share')])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelClass = { new(): any; query(): any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResourceClass = { new(): any; getSlug(): string; model?: ModelClass }

export interface PanelColumnMeta {
  name:        string
  label:       string
  sortable?:   boolean
  searchable?: boolean
  type?:       ColumnMeta['type']
  format?:     string
  href?:       string
}

export interface TableElementMeta {
  type:              'table'
  title:             string
  resource:          string
  columns:           PanelColumnMeta[]
  records:           unknown[]
  href:              string
  description?:      string
  emptyMessage?:     string
  reorderable?:      boolean
  reorderEndpoint?:  string
  searchable?:       boolean
  searchColumns?:    string[] | undefined
  filters?:          FilterMeta[]
  actions?:          ActionMeta[]
  lazy?:             boolean
  pollInterval?:     number
  id?:               string
  pagination?: {
    total:       number
    currentPage: number
    perPage:     number
    lastPage:    number
    type:        'pages' | 'loadMore'
  }
}

export interface TableConfig {
  title:          string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resourceClass?: any              // fromResource() — Resource class
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?:         any              // fromModel() — direct model class
  rows?:          Record<string, unknown>[] | undefined  // static rows — no model needed
  columns:        string[] | Column[]
  limit:          number
  sortBy:         string | undefined
  sortDir:        'ASC' | 'DESC'
  reorderable:    boolean
  reorderField:   string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scope?:         ((query: any) => any) | undefined     // custom query scope
  description?:   string | undefined
  emptyMessage?:  string | undefined
  href?:          string | undefined                    // override auto-generated href
  searchable?:    boolean | undefined
  searchColumns?: string[] | undefined
  paginationType?: 'pages' | 'loadMore' | undefined
  perPage:        number
  filters:        Filter[]
  actions:        Action[]
  lazy?:          boolean | undefined
  pollInterval?:  number | undefined
  id?:            string | undefined
}

export class Table {
  private _title:          string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _resourceClass?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _model?:         any
  private _rows?:          Record<string, unknown>[]
  private _columns:        string[] | Column[] = []
  private _limit:          number              = 5
  private _sortBy?:        string
  private _sortDir:        'ASC' | 'DESC'      = 'DESC'
  private _reorderable:    boolean             = false
  private _reorderField:   string              = 'position'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _scope?:         (query: any) => any
  private _description?:   string
  private _emptyMessage?:  string
  private _href?:          string
  private _searchable:     boolean = false
  private _searchColumns?: string[] | undefined
  private _paginationType?: 'pages' | 'loadMore'
  private _perPage:        number  = 15
  private _lazy:           boolean = false
  private _pollInterval?:  number
  private _id?:            string
  private _filters:        Filter[] = []
  private _actions:        Action[] = []

  protected constructor(title: string) {
    this._title = title
  }

  static make(title: string): Table {
    return new Table(title)
  }

  /**
   * Use a Resource class as the data source.
   * Inherits the Resource's model, default sort, and field labels.
   *
   * @example
   * Table.make('Recent Articles')
   *   .fromResource(ArticleResource)
   *   .columns(['title', 'createdAt'])
   *   .limit(5)
   *
   * // With explicit Column definitions:
   * Table.make('Recent Articles')
   *   .fromResource(ArticleResource)
   *   .columns([Column.make('title').sortable(), Column.make('createdAt').date()])
   */
  fromResource(resourceClass: ResourceClass): this {
    this._resourceClass = resourceClass
    this._model         = resourceClass.model
    return this
  }

  /**
   * Use an ORM Model class directly as the data source (no Resource needed).
   * Define display columns with Column.make().
   *
   * @example
   * Table.make('All Users')
   *   .fromModel(User)
   *   .columns([Column.make('name').sortable().searchable(), Column.make('email')])
   *   .limit(10)
   */
  fromModel(model: ModelClass): this {
    this._model = model
    return this
  }

  /**
   * Provide static row data — no model or resource needed.
   *
   * @example
   * Table.make('Browsers')
   *   .rows([{ name: 'Chrome', share: 65 }, { name: 'Firefox', share: 10 }])
   *   .columns([Column.make('name'), Column.make('share')])
   */
  rows(data: Record<string, unknown>[]): this {
    this._rows = data
    return this
  }

  /**
   * Apply a custom scope to the query before sort/limit.
   * Works with both fromResource() and fromModel().
   *
   * @example
   * Table.make('Published Articles')
   *   .fromResource(ArticleResource)
   *   .scope((q) => q.where('published', true))
   *   .columns(['title', 'createdAt'])
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scope(fn: (query: any) => any): this {
    this._scope = fn
    return this
  }

  /** A short description displayed below the table title. */
  description(text: string): this {
    this._description = text
    return this
  }

  /** Message shown when the table has no records. Defaults to framework UI. */
  emptyMessage(text: string): this {
    this._emptyMessage = text
    return this
  }

  /** Override the auto-generated link for the table header (e.g. "View all"). */
  href(url: string): this {
    this._href = url
    return this
  }

  /** Column names (resolved via Resource fields) or Column instances. */
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

  /**
   * Mark the table as searchable.
   * Optionally specify which columns are searchable — defaults to all columns.
   */
  searchable(columns?: string[]): this {
    this._searchable    = true
    this._searchColumns = columns
    return this
  }

  /**
   * Enable pagination for the table.
   *
   * @param mode    - 'pages' (numbered pages) or 'loadMore' (append rows). Default: 'pages'.
   * @param perPage - Number of records per page. Default: 15.
   */
  paginated(mode: 'pages' | 'loadMore' = 'pages', perPage = 15): this {
    this._paginationType = mode
    this._perPage        = perPage
    return this
  }

  /** Unique ID for this table. Auto-generated from title if not set. Required for lazy/poll/paginated tables with API endpoint. */
  id(id: string): this {
    this._id = id
    return this
  }

  /** Defer data loading to client-side. Shows skeleton on initial SSR render. */
  lazy(): this {
    this._lazy = true
    return this
  }

  /** Re-fetch table data every N milliseconds. First render uses SSR data. */
  poll(ms: number): this {
    this._pollInterval = ms
    return this
  }

  /** Attach filter dropdowns to the table header. */
  filters(filters: Filter[]): this {
    this._filters = filters
    return this
  }

  /** Attach bulk/row actions to the table. */
  actions(actions: Action[]): this {
    this._actions = actions
    return this
  }

  getFilters(): Filter[] { return this._filters }
  getActions(): Action[] { return this._actions }

  isLazy(): boolean { return this._lazy }
  getPollInterval(): number | undefined { return this._pollInterval }
  getId(): string { return this._id ?? this._title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') }

  getType(): 'table' { return 'table' }

  getConfig(): TableConfig {
    return {
      title:         this._title,
      resourceClass: this._resourceClass,
      model:         this._model,
      rows:          this._rows,
      columns:       this._columns,
      limit:         this._limit,
      sortBy:        this._sortBy,
      sortDir:       this._sortDir,
      reorderable:   this._reorderable,
      reorderField:  this._reorderField,
      scope:          this._scope,
      description:    this._description,
      emptyMessage:   this._emptyMessage,
      href:           this._href,
      searchable:     this._searchable || undefined,
      searchColumns:  this._searchColumns,
      paginationType: this._paginationType,
      perPage:        this._perPage,
      filters:        this._filters,
      actions:        this._actions,
      lazy:           this._lazy || undefined,
      pollInterval:   this._pollInterval,
      id:             this.getId(),
    }
  }
}
