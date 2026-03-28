import { List } from './List.js'
import type { ListConfig } from './List.js'
import { Column } from './Column.js'
import type { ColumnMeta } from './Column.js'
import type { FilterMeta } from './Filter.js'
import type { ActionMeta } from './Action.js'
import { ViewMode } from './ViewMode.js'

// ─── Table schema element ──────────────────────────────────
// Extends List with column layout.
// All shared features (data sources, search, pagination, filters, scopes,
// sortable, reorderable, onSave, views, actions, live, etc.) are on List.

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
  editField?:  import('./Field.js').FieldMeta
}

/** @deprecated Tables now resolve as DataViewElementMeta via resolveListElement. */
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

export interface TableConfig extends ListConfig {
  columns: string[] | Column[]
}

export class Table extends List {
  private _columns: string[] | Column[] = []
  private _resolvedViews: ViewMode[] | undefined = undefined

  protected constructor(title: string) {
    super(title)
  }

  static make(title: string): Table {
    return new Table(title)
  }

  /** Column names (resolved via Resource fields) or Column instances. */
  columns(cols: string[] | Column[]): this {
    this._columns = cols
    return this
  }

  // ── Overrides ─────────────────────────────────────

  getType(): 'table' { return 'table' }

  /**
   * Lazily resolves views: when no explicit views are defined and columns exist,
   * auto-creates a table ViewMode from the columns. The result is cached to
   * avoid creating new objects on every call.
   */
  private _getViews(): ViewMode[] {
    if (this._resolvedViews) return this._resolvedViews
    const baseViews = super.getConfig().views
    if (baseViews.length > 0 || this._columns.length === 0) return baseViews
    const cols = typeof this._columns[0] === 'string'
      ? (this._columns as string[]).map(name => Column.make(name))
      : this._columns as Column[]
    this._resolvedViews = [ViewMode.table(cols)]
    return this._resolvedViews
  }

  getConfig(): TableConfig {
    return { ...super.getConfig(), columns: this._columns, views: this._getViews() }
  }

  /**
   * @internal — Create a copy with a different scope and ID.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _cloneWithScope(id: string, scopeFn?: (query: any) => any): Table {
    const clone = Table.make(this._title)
    this._cloneBase(clone)
    clone._columns = this._columns
    clone._resolvedViews = undefined
    clone._id = id
    if (scopeFn) clone._scope = scopeFn
    else if (this._scope) clone._scope = this._scope
    return clone
  }
}
