import { List } from './List.js'
import type { ListConfig } from './List.js'
import { Column } from './Column.js'
import type { ColumnMeta } from './Column.js'
import type { FilterMeta } from './Filter.js'
import type { ActionMeta } from './Action.js'
import type { PersistMode } from '../persist.js'
import { ViewMode } from './ViewMode.js'

// ─── Table schema element ──────────────────────────────────
// Extends List with column layout.
// All shared features (data sources, search, pagination, filters, scopes,
// sortable, reorderable, onSave, views, actions, live, etc.) are on List.

export type TableRememberMode = PersistMode

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

  getConfig(): TableConfig {
    const base = super.getConfig()
    const config: TableConfig = { ...base, columns: this._columns }

    // Auto-create a table ViewMode from columns when no explicit views defined.
    // This ensures resolveListElement includes column fields in record stripping.
    if (base.views.length === 0 && this._columns.length > 0) {
      const cols = typeof this._columns[0] === 'string'
        ? (this._columns as string[]).map(name => Column.make(name))
        : this._columns as Column[]
      config.views = [ViewMode.table(cols)]
    }

    return config
  }

  /**
   * @internal — Create a copy with a different scope and ID.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _cloneWithScope(id: string, scopeFn?: (query: any) => any): Table {
    const clone = Table.make(this._title)
    this._cloneBase(clone)
    clone._columns = this._columns
    clone._id = id
    if (scopeFn) clone._scope = scopeFn
    else if (this._scope) clone._scope = this._scope
    return clone
  }
}
