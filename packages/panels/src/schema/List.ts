import type { Filter } from './Filter.js'
import type { Action } from './Action.js'
import type { DataSource } from '../datasource.js'
import type { PersistMode } from '../persist.js'
import type { PanelContext } from '../types.js'
import { ViewMode } from './ViewMode.js'
import type { ViewModeMeta } from './ViewMode.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelClass = { new(): any; query(): any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResourceClass = { new(): any; getSlug(): string; model?: ModelClass }
type SchemaElement = { getType(): string }

// ─── Legacy ListItem (kept for backward compat with .items()) ──
export interface ListItem {
  label:        string
  description?: string
  href?:        string
  icon?:        string
}

// ─── Sortable option ──────────────────────────────────
export type SortableOption = string | { field: string; label: string }

// ─── Scope preset ─────────────────────────────────────
export interface ScopePreset {
  label:  string
  icon?:  string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scope?: (query: any) => any
}

// ─── View type for config ─────────────────────────────
export type ViewPreset = 'list' | 'grid'

// ─── List config (shared by all data-view elements) ──
export interface ListConfig {
  title:             string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resourceClass?:    any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?:            any
  rows?:             DataSource | undefined
  limit:             number
  sortBy:            string | undefined
  sortDir:           'ASC' | 'DESC'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scope?:            ((query: any) => any) | undefined
  description?:      string | undefined
  emptyMessage?:     string | undefined
  href?:             string | undefined
  searchable?:       boolean | undefined
  searchColumns?:    string[] | undefined
  paginationType?:   'pages' | 'loadMore' | undefined
  perPage:           number
  filters:           Filter[]
  actions:           Action[]
  lazy?:             boolean | undefined
  pollInterval?:     number | undefined
  live?:             boolean | undefined
  id?:               string | undefined
  remember?:         PersistMode | undefined
  softDeletes:       boolean
  titleField?:       string | undefined
  descriptionField?: string | undefined
  imageField?:       string | undefined
  emptyState?:       { icon?: string; heading?: string; description?: string } | undefined
  creatableUrl?:     string | boolean | undefined
  views:             ViewMode[]
  activeView?:       string | undefined
  renderFn?:         ((record: Record<string, unknown>) => SchemaElement[]) | undefined
  groupBy?:          string | undefined
  onRecordClick?:    'view' | 'edit' | ((record: Record<string, unknown>) => string) | undefined
  exportable?:       ('csv' | 'json')[] | boolean | undefined
  defaultView?:      Record<string, string> | undefined
  folderField?:      string | undefined
  sortableOptions?:  { field: string; label: string }[] | undefined
  scopes?:           ScopePreset[] | undefined
}

// ─── Legacy ListElementMeta (kept for backward compat) ──
export interface ListElementMeta {
  type:          'list'
  title:         string
  items:         ListItem[]
  limit:         number
  id?:           string
  description?:  string
  lazy?:         boolean
  pollInterval?: number
  live?:         boolean
}

// ─── List base class ──────────────────────────────────

export class List {
  // ── Shared data-view fields ──
  protected _title:            string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected _resourceClass?:   any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected _model?:           any
  protected _rows?:            DataSource
  protected _limit             = 5
  protected _sortBy?:          string
  protected _sortDir:          'ASC' | 'DESC' = 'DESC'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected _scope?:           (query: any) => any
  protected _description?:     string
  protected _emptyMessage?:    string
  protected _href?:            string
  protected _searchable        = false
  protected _searchColumns?:   string[]
  protected _paginationType?:  'pages' | 'loadMore'
  protected _perPage           = 15
  protected _lazy              = false
  protected _pollInterval?:    number
  protected _live              = false
  protected _id?:              string
  protected _remember:         PersistMode = false
  protected _filters:          Filter[] = []
  protected _actions:          Action[] = []
  protected _softDeletes       = false
  protected _titleField?:      string
  protected _descriptionField?: string
  protected _imageField?:      string
  protected _emptyState?:      { icon?: string; heading?: string; description?: string }
  protected _creatableUrl?:    string | boolean
  protected _views:            ViewMode[] = []
  protected _renderFn?:        (record: Record<string, unknown>) => SchemaElement[]
  protected _groupBy?:         string
  protected _onRecordClick?:   'view' | 'edit' | ((record: Record<string, unknown>) => string)
  protected _exportable?:      ('csv' | 'json')[] | boolean
  protected _defaultView?:     Record<string, string>
  protected _folderField?:     string
  protected _sortableOptions?: { field: string; label: string }[]
  protected _scopes?:          ScopePreset[]

  // ── Legacy fields (backward compat with old List API) ──
  protected _items:            ListItem[] = []
  protected _dataFn?:          (ctx: PanelContext) => Promise<ListItem[]>

  protected constructor(title: string) {
    this._title = title
  }

  static make(title: string): List {
    return new List(title)
  }

  // ── Data sources ──────────────────────────────────

  /**
   * Use a Resource class as the data source.
   * Inherits the Resource's model, default sort, and field labels.
   */
  fromResource(resourceClass: ResourceClass): this {
    this._resourceClass = resourceClass
    this._model         = resourceClass.model
    return this
  }

  /**
   * Use an ORM Model class directly as the data source.
   */
  fromModel(model: ModelClass): this {
    this._model = model
    return this
  }

  /**
   * Provide data from a static array or async function.
   */
  fromArray(data: DataSource): this {
    this._rows = data
    return this
  }

  /**
   * Apply a custom scope to the query.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scope(fn: (query: any) => any): this {
    this._scope = fn
    return this
  }

  // ── Display ───────────────────────────────────────

  /** A short description displayed below the title. */
  description(text: string): this {
    this._description = text
    return this
  }

  /** Message shown when no records exist. */
  emptyMessage(text: string): this {
    this._emptyMessage = text
    return this
  }

  /** Override the auto-generated link for the header. */
  href(url: string): this {
    this._href = url
    return this
  }

  /** Max records (non-paginated). */
  limit(n: number): this {
    this._limit = n
    return this
  }

  /** Default sort column and direction. */
  sortBy(col: string, dir: 'ASC' | 'DESC' = 'DESC'): this {
    this._sortBy  = col
    this._sortDir = dir
    return this
  }

  /** Field used as the record's display title. */
  titleField(name: string): this {
    this._titleField = name
    return this
  }

  /** Field used as the record's display description/subtitle. */
  descriptionField(name: string): this {
    this._descriptionField = name
    return this
  }

  /** Field used as the record's display image/thumbnail. */
  imageField(name: string): this {
    this._imageField = name
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

  // ── Query/Filter ──────────────────────────────────

  /** Mark as searchable. Optionally specify which columns to search. */
  searchable(columns?: string[]): this {
    this._searchable    = true
    if (columns) this._searchColumns = columns
    return this
  }

  /**
   * Show a sort-by dropdown in the toolbar.
   * Accepts field names (labels auto-derived) or `{ field, label }` objects for custom labels.
   *
   * @example
   * .sortable(['title', 'date'])
   * .sortable([{ field: 'title', label: 'العنوان' }, { field: 'date', label: 'التاريخ' }])
   */
  sortable(options: SortableOption[]): this {
    this._sortableOptions = options.map(o =>
      typeof o === 'string'
        ? { field: o, label: o.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim() }
        : o
    )
    return this
  }

  /**
   * User-visible scope toggles rendered as pills/tabs in the toolbar.
   * One active at a time. Runs on top of `.scope()`.
   *
   * @example
   * .scopes([
   *   { label: 'All' },
   *   { label: 'Published', icon: 'circle-check', scope: q => q.where('status', 'published') },
   *   { label: 'Drafts', icon: 'pencil-line', scope: q => q.where('status', 'draft') },
   * ])
   */
  scopes(presets: ScopePreset[]): this {
    this._scopes = presets
    return this
  }

  /** Attach filter dropdowns. */
  filters(filters: Filter[]): this {
    this._filters = filters
    return this
  }

  /** Enable soft-delete support (trashed/active toggle). */
  softDeletes(value = true): this {
    this._softDeletes = value
    return this
  }

  // ── Pagination ────────────────────────────────────

  /** Enable pagination. */
  paginated(mode: 'pages' | 'loadMore' = 'pages', perPage = 15): this {
    this._paginationType = mode
    this._perPage        = perPage
    return this
  }

  // ── Interaction ───────────────────────────────────

  /** Attach bulk/row actions. */
  actions(actions: Action[]): this {
    this._actions = actions
    return this
  }

  /**
   * Configure what happens when clicking a record.
   * `'view'` → navigate to /{id}, `'edit'` → /{id}/edit, function → custom URL.
   */
  onRecordClick(handler: 'view' | 'edit' | ((record: Record<string, unknown>) => string)): this {
    this._onRecordClick = handler
    return this
  }

  // ── Grouping ──────────────────────────────────────

  /** Group records by a field value. Renders group headers in views. */
  groupBy(field: string): this {
    this._groupBy = field
    return this
  }

  // ── Folder navigation ─────────────────────────────

  /**
   * Enable folder-style drill-down navigation.
   * Scopes query to WHERE parentField = :currentFolder (root = null).
   */
  folder(parentField: string): this {
    this._folderField = parentField
    return this
  }

  // ── Export ────────────────────────────────────────

  /** Add export button to toolbar. Downloads filtered/searched dataset. */
  exportable(formats: ('csv' | 'json')[] | boolean = true): this {
    this._exportable = formats
    return this
  }

  // ── State ─────────────────────────────────────────

  /** Persist navigation state across page loads. */
  remember(mode: PersistMode = 'localStorage'): this {
    this._remember = mode
    return this
  }

  getRemember(): PersistMode { return this._remember }

  // ── Real-time ─────────────────────────────────────

  /** Defer data loading to client-side. */
  lazy(): this {
    this._lazy = true
    return this
  }

  /** Re-fetch data every N milliseconds. */
  poll(ms: number): this {
    this._pollInterval = ms
    return this
  }

  /** Enable real-time updates via WebSocket. */
  live(): this {
    this._live = true
    return this
  }

  /** Unique ID for this element. Auto-generated from title if not set. */
  id(id: string): this {
    this._id = id
    return this
  }

  // ── Views ─────────────────────────────────────────

  /** Single custom render function per record. */
  render(fn: (record: Record<string, unknown>) => SchemaElement[]): this {
    this._renderFn = fn
    return this
  }

  /** Multiple view modes with user toggle. */
  views(defs: (ViewPreset | ViewMode)[]): this {
    this._views = defs.map(d => {
      if (typeof d === 'string') {
        return d === 'grid' ? ViewMode.grid() : ViewMode.list()
      }
      return d
    })
    return this
  }

  /**
   * Responsive default view per container breakpoint.
   * SSR renders largest breakpoint. Client detects + persists on first visit.
   */
  defaultView(map: Record<string, string>): this {
    this._defaultView = map
    return this
  }

  // ── Legacy API (backward compat) ──────────────────

  /** Static list items (legacy). Use `.fromArray()` for new code. */
  items(items: ListItem[]): this {
    this._items = items
    return this
  }

  /** Async data function for list items (legacy). Use `.fromArray()` for new code. */
  data(fn: (ctx: PanelContext) => Promise<ListItem[]>): this {
    this._dataFn = fn
    return this
  }

  // ── Getters ───────────────────────────────────────

  getId(): string {
    return this._id ?? this._title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  }

  getDataFn(): ((ctx: PanelContext) => Promise<ListItem[]>) | undefined { return this._dataFn }
  isLazy(): boolean { return this._lazy }
  isLive(): boolean { return this._live }
  getPollInterval(): number | undefined { return this._pollInterval }
  getFilters(): Filter[] { return this._filters }
  getActions(): Action[] { return this._actions }
  getType(): string {
    // If this List has data-view features (model/views/search/pagination), resolve as 'dataview'
    // Otherwise fall back to legacy 'list' (simple static items)
    if (this._model || this._resourceClass || this._rows || this._views.length > 0 || this._renderFn || this._searchable || this._paginationType) {
      return 'dataview'
    }
    return 'list'
  }

  // ── Config ────────────────────────────────────────

  getConfig(): ListConfig {
    return {
      title:           this._title,
      resourceClass:   this._resourceClass,
      model:           this._model,
      rows:            this._rows,
      limit:           this._limit,
      sortBy:          this._sortBy,
      sortDir:         this._sortDir,
      scope:           this._scope,
      description:     this._description,
      emptyMessage:    this._emptyMessage,
      href:            this._href,
      searchable:      this._searchable || undefined,
      searchColumns:   this._searchColumns,
      paginationType:  this._paginationType,
      perPage:         this._perPage,
      filters:         this._filters,
      actions:         this._actions,
      lazy:            this._lazy || undefined,
      pollInterval:    this._pollInterval,
      live:            this._live || undefined,
      id:              this.getId(),
      remember:        this._remember || undefined,
      softDeletes:     this._softDeletes,
      titleField:      this._titleField,
      descriptionField: this._descriptionField,
      imageField:      this._imageField,
      emptyState:      this._emptyState,
      creatableUrl:    this._creatableUrl,
      views:           this._views,
      renderFn:        this._renderFn,
      groupBy:         this._groupBy,
      onRecordClick:   this._onRecordClick,
      exportable:      this._exportable,
      defaultView:     this._defaultView,
      folderField:     this._folderField,
      sortableOptions: this._sortableOptions,
      scopes:          this._scopes,
    }
  }

  // ── Clone helper (used by Table._cloneWithScope) ──

  /** @internal — Copy all List fields to target. */
  _cloneBase(target: List): void {
    target._resourceClass   = this._resourceClass
    target._model           = this._model
    if (this._rows) target._rows = this._rows
    target._limit           = this._limit
    target._sortDir         = this._sortDir
    target._searchable      = this._searchable
    target._perPage         = this._perPage
    target._lazy            = this._lazy
    target._live            = this._live
    target._remember        = this._remember
    target._filters         = this._filters
    target._actions         = this._actions
    target._softDeletes     = this._softDeletes
    if (this._sortBy)          target._sortBy          = this._sortBy
    if (this._description)     target._description     = this._description
    if (this._emptyMessage)    target._emptyMessage    = this._emptyMessage
    if (this._href)            target._href            = this._href
    if (this._searchColumns)   target._searchColumns   = [...this._searchColumns]
    if (this._paginationType)  target._paginationType  = this._paginationType
    if (this._pollInterval)    target._pollInterval    = this._pollInterval
    if (this._titleField)      target._titleField      = this._titleField
    if (this._descriptionField) target._descriptionField = this._descriptionField
    if (this._imageField)      target._imageField      = this._imageField
    if (this._emptyState)      target._emptyState      = this._emptyState
    if (this._creatableUrl)    target._creatableUrl    = this._creatableUrl
    if (this._groupBy)         target._groupBy         = this._groupBy
    if (this._folderField)     target._folderField     = this._folderField
    if (this._sortableOptions) target._sortableOptions = [...this._sortableOptions]
    if (this._scopes)          target._scopes          = [...this._scopes]
    if (this._onRecordClick)   target._onRecordClick   = this._onRecordClick
    if (this._exportable)      target._exportable      = this._exportable
    if (this._defaultView)     target._defaultView     = this._defaultView
    if (this._renderFn)        target._renderFn        = this._renderFn
    if (this._views.length)    target._views           = [...this._views]
    if (this._scope)           target._scope           = this._scope
  }

  // ── Legacy toMeta (for backward compat with existing list resolver) ──

  toMeta(): ListElementMeta {
    const meta: ListElementMeta = {
      type:  'list',
      title: this._title,
      items: this._items.slice(0, this._limit),
      limit: this._limit,
    }
    const id = this._id ?? (this._dataFn || this._lazy || this._pollInterval ? this.getId() : undefined)
    if (id) meta.id = id
    if (this._description !== undefined) meta.description = this._description
    if (this._lazy) meta.lazy = true
    if (this._pollInterval !== undefined) meta.pollInterval = this._pollInterval
    if (this._live) meta.live = true
    return meta
  }
}
