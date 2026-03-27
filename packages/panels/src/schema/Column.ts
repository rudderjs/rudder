// ─── Column — extends DataField with table-specific features ──
//
// Column adds .sortable() and .searchable() on top of DataField.
// Used in Table.columns() and ViewMode.table().
// Backward compatible — existing Column API unchanged.

import { DataField } from './DataField.js'
import type { DataFieldMeta, EditMode } from './DataField.js'

export type { EditMode } from './DataField.js'

export interface ColumnMeta extends DataFieldMeta {
  sortable:   boolean
  searchable: boolean
}

export class Column extends DataField {
  private _sortable:   boolean = false
  private _searchable: boolean = false

  protected constructor(name: string) {
    super(name)
  }

  static make(name: string): Column {
    return new Column(name)
  }

  /** Mark column as sortable (click header to sort). */
  sortable(val = true): this  { this._sortable   = val; return this }

  /** Mark column as searchable (included in search query). */
  searchable(val = true): this { this._searchable = val; return this }

  // ── Getters ───────────────────────────────────────

  isSortable(): boolean   { return this._sortable }
  isSearchable(): boolean { return this._searchable }

  // ── Serialization ─────────────────────────────────

  toMeta(): ColumnMeta {
    const base = super.toMeta()
    return {
      ...base,
      sortable:   this._sortable,
      searchable: this._searchable,
    }
  }
}
