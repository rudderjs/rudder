import type { Column, ColumnMeta } from './Column.js'
import type { Field } from './Field.js'
import type { Action, ActionMeta } from './Action.js'
import type { FieldOrGrouping, SchemaItemMeta } from '../Resource.js'
import { toTitleCase } from './utils.js'

// ─── RelationManager meta (for UI) ───────────────────────

export interface RelationManagerMeta {
  type:         'relationManager'
  name:         string
  label:        string
  icon:         string | undefined
  columns:      ColumnMeta[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formFields:   any[]
  actions:      ActionMeta[]
  creatable:    boolean
  editable:     boolean
  deletable:    boolean
  foreignKey:   string | undefined
  relationship: string
  perPage:      number
}

// ─── RelationManager class ────────────────────────────────

/**
 * Manages a hasMany/belongsToMany relation inline on a resource page.
 * Renders as a mini CRUD table embedded in the detail or edit view.
 *
 * @example
 * // In Resource.relations()
 * relations() {
 *   return [
 *     RelationManager.make('comments')
 *       .label('Comments')
 *       .columns([
 *         Column.make('author').sortable(),
 *         Column.make('body'),
 *         Column.make('createdAt').label('Date'),
 *       ])
 *       .form([
 *         TextField.make('author').required(),
 *         TextareaField.make('body').required(),
 *       ])
 *       .creatable()
 *       .editable()
 *       .deletable(),
 *   ]
 * }
 */
export class RelationManager {
  protected _name:         string
  protected _label?:       string
  protected _icon?:        string
  protected _columns:      Column[] = []
  protected _formFields:   FieldOrGrouping[] = []
  protected _actions:      Action[] = []
  protected _creatable     = false
  protected _editable      = false
  protected _deletable     = false
  protected _foreignKey?:  string
  protected _relationship: string
  protected _perPage       = 10

  constructor(name: string) {
    this._name = name
    this._relationship = name
  }

  static make(name: string): RelationManager {
    return new RelationManager(name)
  }

  label(label: string): this {
    this._label = label
    return this
  }

  icon(icon: string): this {
    this._icon = icon
    return this
  }

  /** Define the columns shown in the relation table. */
  columns(columns: Column[]): this {
    this._columns = columns
    return this
  }

  /** Define form fields for creating/editing related records. */
  form(fields: FieldOrGrouping[]): this {
    this._formFields = fields
    return this
  }

  /** Bulk/row actions on related records. */
  actions(actions: Action[]): this {
    this._actions = actions
    return this
  }

  /** Allow creating new related records (default: false). */
  creatable(val = true): this {
    this._creatable = val
    return this
  }

  /** Allow editing related records inline (default: false). */
  editable(val = true): this {
    this._editable = val
    return this
  }

  /** Allow deleting related records (default: false). */
  deletable(val = true): this {
    this._deletable = val
    return this
  }

  /** Override the foreign key used to filter related records. */
  foreignKey(key: string): this {
    this._foreignKey = key
    return this
  }

  /** Override the relationship name (defaults to the manager name). */
  relationship(name: string): this {
    this._relationship = name
    return this
  }

  /** Records per page in the relation table (default: 10). */
  perPage(n: number): this {
    this._perPage = n
    return this
  }

  // ── Getters ────────────────────────────────────────

  getName(): string { return this._name }
  getType(): string { return 'relationManager' }
  getRelationship(): string { return this._relationship }
  getForeignKey(): string | undefined { return this._foreignKey }
  getFormFields(): FieldOrGrouping[] { return this._formFields }

  getLabel(): string {
    if (this._label) return this._label
    return toTitleCase(this._name)
  }

  toMeta(): RelationManagerMeta {
    return {
      type:         'relationManager',
      name:         this._name,
      label:        this.getLabel(),
      icon:         this._icon,
      columns:      this._columns.map(c => c.toMeta()),
      formFields:   this._formFields.map(f => (f as { toMeta(): unknown }).toMeta()),
      actions:      this._actions.map(a => a.toMeta()),
      creatable:    this._creatable,
      editable:     this._editable,
      deletable:    this._deletable,
      foreignKey:   this._foreignKey,
      relationship: this._relationship,
      perPage:      this._perPage,
    }
  }
}
