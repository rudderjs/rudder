import { List } from './List.js'
import type { ListConfig } from './List.js'
import type { Column } from './Column.js'
import type { PanelContext } from '../types.js'

// ─── Table2 schema element ──────────────────────────────────
// Extends List with column layout, inline editing, and reorder.
// Uses .scopes() (from List) instead of .tabs() for filtered views.

type TableSaveHandler = (record: Record<string, unknown>, field: string, value: unknown, ctx: PanelContext) => Promise<void> | void

export interface Table2Config extends ListConfig {
  columns:       string[] | Column[]
  reorderable:   boolean
  reorderField:  string
  onSave?:       TableSaveHandler | undefined
}

export class Table2 extends List {
  private _columns:       string[] | Column[] = []
  private _reorderable    = false
  private _reorderField   = 'position'
  private _onSaveFn?:     TableSaveHandler

  protected constructor(title: string) {
    super(title)
  }

  static make(title: string): Table2 {
    return new Table2(title)
  }

  // ── Table-only methods ────────────────────────────

  /** Column names (resolved via Resource fields) or Column instances. */
  columns(cols: string[] | Column[]): this {
    this._columns = cols
    return this
  }

  /**
   * Enable drag-to-reorder rows.
   * Saves the new order to `positionField` (default: 'position') via the panel API.
   */
  reorderable(positionField = 'position'): this {
    this._reorderable  = true
    this._reorderField = positionField
    return this
  }

  /** Table-level save handler for inline editing. */
  onSave(fn: TableSaveHandler): this {
    this._onSaveFn = fn
    return this
  }

  getOnSave(): TableSaveHandler | undefined { return this._onSaveFn }

  // ── Overrides ─────────────────────────────────────

  getType(): 'table' { return 'table' }

  getConfig(): Table2Config {
    return {
      ...super.getConfig(),
      columns:      this._columns,
      reorderable:  this._reorderable,
      reorderField: this._reorderField,
      onSave:       this._onSaveFn,
    }
  }

  /**
   * @internal — Create a copy of this table with a different scope and ID.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _cloneWithScope(id: string, scopeFn?: (query: any) => any): Table2 {
    const clone = Table2.make(this._title)
    this._cloneBase(clone)
    clone._columns      = this._columns
    clone._reorderable  = this._reorderable
    clone._reorderField = this._reorderField
    if (this._onSaveFn)  clone._onSaveFn  = this._onSaveFn
    clone._id = id
    if (scopeFn) clone._scope = scopeFn
    else if (this._scope) clone._scope = this._scope
    return clone
  }
}
