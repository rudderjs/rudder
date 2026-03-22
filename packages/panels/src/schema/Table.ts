import type { Column, ColumnMeta } from './Column.js'
import type { Filter, FilterMeta } from './Filter.js'
import type { Action, ActionMeta, ActionHandler } from './Action.js'
import type { DataSource } from '../datasource.js'
import type { PersistMode } from '../persist.js'
import type { Tab } from './Tabs.js'
import type { ListTab } from './Tab.js'

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

export type TableRememberMode = PersistMode

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelClass = { new(): any; query(): any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResourceClass = { new(): any; getSlug(): string; model?: ModelClass }

type TableSaveHandler = (record: Record<string, unknown>, field: string, value: unknown, ctx: import('../types.js').PanelContext) => Promise<void> | void

export interface PanelColumnMeta {
  name:        string
  label:       string
  sortable?:   boolean
  searchable?: boolean
  type?:       ColumnMeta['type']
  format?:     string
  href?:       string
  editable?:   boolean
  editMode?:   import('./Column.js').EditMode
  editField?:  import('../schema/Field.js').FieldMeta
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
  editable?:         boolean
  lazy?:             boolean
  pollInterval?:     number
  live?:             boolean
  liveChannel?:      string
  id?:               string
  remember?:         'localStorage' | 'url' | 'session'
  activeSearch?:     string
  activeSort?:       { col: string; dir: string }
  activeFilters?:    Record<string, string>
  pagination?: {
    total:       number
    currentPage: number
    perPage:     number
    lastPage:    number
    type:        'pages' | 'loadMore'
  }
  tabs?:         { label: string; icon?: string; scope?: boolean }[]
  softDeletes?:  boolean
  titleField?:   string
  emptyState?:   { icon?: string; heading?: string; description?: string }
  creatableUrl?: string | boolean
}

export interface TableConfig {
  title:          string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resourceClass?: any              // fromResource() — Resource class
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?:         any              // fromModel() — direct model class
  rows?:          DataSource | undefined  // static array or async function — no model needed
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
  live?:          boolean | undefined
  id?:            string | undefined
  remember?:      TableRememberMode | undefined
  onSave?:        TableSaveHandler | undefined
  tabs:           Tab[]
  listTabs:       ListTab[]
  softDeletes:    boolean
  titleField?:    string | undefined
  emptyState?:    { icon?: string; heading?: string; description?: string } | undefined
  creatableUrl?:  string | boolean | undefined
}

export class Table {
  private _title:          string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _resourceClass?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _model?:         any
  private _rows?:          DataSource
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
  private _live:           boolean = false
  private _id?:            string
  private _remember:       TableRememberMode = false
  private _filters:        Filter[] = []
  private _actions:        Action[] = []
  private _onSaveFn?:      TableSaveHandler
  private _tabs:           Tab[] = []
  private _listTabs:       ListTab[] = []
  private _softDeletes:    boolean = false
  private _titleField?:    string
  private _emptyState?:    { icon?: string; heading?: string; description?: string }
  private _creatableUrl?:  string | boolean

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
   * Provide data from a static array or async function — no model or resource needed.
   *
   * @example
   * // Static array
   * Table.make('Browsers')
   *   .fromArray([{ name: 'Chrome', share: 65 }, { name: 'Firefox', share: 10 }])
   *
   * // Async function (SSR'd, supports .lazy() and .poll())
   * Table.make('External Data')
   *   .fromArray(async (ctx) => {
   *     const res = await fetch('https://api.example.com/stats')
   *     return res.json()
   *   })
   */
  fromArray(data: DataSource): this {
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

  /**
   * Enable real-time updates via WebSocket.
   * When data changes on the server, the table refreshes automatically.
   * Uses @boostkit/broadcast for push notifications.
   */
  live(): this {
    this._live = true
    return this
  }

  /**
   * Persist table navigation state (page, sort, search, filters) across page loads.
   *
   * - `'localStorage'` — browser localStorage
   * - `'url'` — URL query params (shareable)
   * - `'session'` — server session
   * - `false` — no persistence (default)
   */
  remember(mode: TableRememberMode = 'localStorage'): this {
    this._remember = mode
    return this
  }

  getRemember(): TableRememberMode { return this._remember }

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

  /** Table-level save handler for inline editing. Called when no column-level onSave is defined. */
  onSave(fn: TableSaveHandler): this {
    this._onSaveFn = fn
    return this
  }

  getOnSave(): TableSaveHandler | undefined { return this._onSaveFn }

  /** Add Tab-based filter tabs to the table (schema tabs with scope). */
  tabs(tabs: Tab[]): this {
    this._tabs = tabs
    return this
  }

  /** Add ListTab-based filter tabs to the table (legacy resource tabs). */
  listTabs(tabs: ListTab[]): this {
    this._listTabs = tabs
    return this
  }

  getTabs(): Tab[] { return this._tabs }
  getListTabs(): ListTab[] { return this._listTabs }

  /** Enable soft-delete support (trashed/active toggle). */
  softDeletes(value = true): this {
    this._softDeletes = value
    return this
  }

  /** Set the field used as the record's display title. */
  titleField(name: string): this {
    this._titleField = name
    return this
  }

  /** Configure the empty state when no records exist. */
  emptyState(config: { icon?: string; heading?: string; description?: string }): this {
    this._emptyState = config
    return this
  }

  /** Show a "+ Create" button. Pass a URL or true for auto-generated URL. */
  creatable(url: string | boolean = true): this {
    this._creatableUrl = url
    return this
  }

  getFilters(): Filter[] { return this._filters }
  getActions(): Action[] { return this._actions }

  isLazy(): boolean { return this._lazy }
  getPollInterval(): number | undefined { return this._pollInterval }
  isLive(): boolean { return this._live }
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
      live:           this._live || undefined,
      id:             this.getId(),
      remember:       this._remember || undefined,
      onSave:         this._onSaveFn,
      tabs:           this._tabs,
      listTabs:       this._listTabs,
      softDeletes:    this._softDeletes,
      titleField:     this._titleField,
      emptyState:     this._emptyState,
      creatableUrl:   this._creatableUrl,
    }
  }

  /**
   * @internal — Create a copy of this table with a different scope and ID.
   * Used by Resource to create per-tab Table instances from a shared base config.
   * The copy inherits columns, filters, actions, pagination, searchable, remember, etc.
   * Tabs are NOT copied (the clone is one tab's content).
   */
  _cloneWithScope(id: string, scopeFn?: (query: any) => any): Table {
    const clone = Table.make(this._title)
    // Copy data source
    if (this._resourceClass) clone.fromResource(this._resourceClass)
    else if (this._model) clone.fromModel(this._model)
    else if (this._rows) clone.fromArray(this._rows)
    // Copy display config
    clone._columns       = this._columns
    clone._limit         = this._limit
    clone._sortDir       = this._sortDir
    clone._reorderable   = this._reorderable
    clone._reorderField  = this._reorderField
    clone._searchable    = this._searchable
    clone._perPage       = this._perPage
    clone._lazy          = this._lazy
    clone._live          = this._live
    clone._remember      = this._remember
    clone._filters       = this._filters
    clone._actions       = this._actions
    clone._softDeletes   = this._softDeletes
    // Copy optional fields only if set
    if (this._sortBy)         clone._sortBy         = this._sortBy
    if (this._description)    clone._description    = this._description
    if (this._emptyMessage)   clone._emptyMessage   = this._emptyMessage
    if (this._href)           clone._href           = this._href
    if (this._searchColumns)  clone._searchColumns  = this._searchColumns
    if (this._paginationType) clone._paginationType = this._paginationType
    if (this._pollInterval)   clone._pollInterval   = this._pollInterval
    if (this._onSaveFn)       clone._onSaveFn       = this._onSaveFn
    if (this._titleField)     clone._titleField     = this._titleField
    if (this._emptyState)     clone._emptyState     = this._emptyState
    if (this._creatableUrl)   clone._creatableUrl   = this._creatableUrl
    // Apply overrides
    clone._id = id
    if (scopeFn) clone._scope = scopeFn
    else if (this._scope) clone._scope = this._scope
    // Don't copy tabs — this clone IS one tab's table
    return clone
  }
}
