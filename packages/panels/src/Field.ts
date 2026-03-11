// ─── Field visibility ──────────────────────────────────────

export type FieldVisibility = 'table' | 'create' | 'edit' | 'view'

// ─── Conditions ────────────────────────────────────────────

export type ConditionOp =
  | '=' | '!=' | '>' | '>=' | '<' | '<='
  | 'in' | 'not_in'
  | 'truthy' | 'falsy'

export interface Condition {
  type:  'show' | 'hide' | 'disabled'
  field: string
  op:    ConditionOp
  value: unknown   // null for truthy/falsy
}

// ─── Field serialized (for meta endpoint / UI) ─────────────

export interface FieldMeta {
  name:                string
  type:                string
  label:               string
  required:            boolean
  readonly:            boolean
  sortable:            boolean
  searchable:          boolean
  hidden:              FieldVisibility[]
  extra:               Record<string, unknown>
  component?:          string
  conditions?:         Condition[]
  displayTransformed?: boolean
}

// ─── Field base class ──────────────────────────────────────

export abstract class Field {
  protected _name:       string
  protected _label:      string | undefined
  protected _required    = false
  protected _readonly    = false
  protected _sortable    = false
  protected _searchable  = false
  protected _hidden:     Set<FieldVisibility> = new Set()
  protected _extra:      Record<string, unknown> = {}
  protected _component?: string
  protected _conditions: Condition[] = []

  constructor(name: string) {
    this._name = name
  }

  /** Human-readable column label. Defaults to title-cased field name. */
  label(label: string): this {
    this._label = label
    return this
  }

  /** Mark field as required in create / edit forms. */
  required(value = true): this {
    this._required = value
    return this
  }

  /** Show in forms but not editable. Excluded from create / edit payloads. */
  readonly(value = true): this {
    this._readonly = value
    if (value) {
      this._hidden.add('create')
      this._hidden.add('edit')
    }
    return this
  }

  /** Allow sorting by this column in the table. */
  sortable(value = true): this {
    this._sortable = value
    return this
  }

  /** Include in global table search. */
  searchable(value = true): this {
    this._searchable = value
    return this
  }

  /** Hide from specific views. */
  hideFrom(...views: FieldVisibility[]): this {
    for (const v of views) this._hidden.add(v)
    return this
  }

  /** Hide from the table column list entirely. */
  hideFromTable(): this {
    return this.hideFrom('table')
  }

  /** Hide from create form. */
  hideFromCreate(): this {
    return this.hideFrom('create')
  }

  /** Hide from edit form. */
  hideFromEdit(): this {
    return this.hideFrom('edit')
  }

  /**
   * Key for a custom React renderer registered in CustomFieldRenderers.tsx.
   * Use when built-in field types don't cover your UI needs.
   *
   * @example
   * NumberField.make('priority').component('rating')
   */
  component(key: string): this {
    this._component = key
    return this
  }

  /**
   * Show this field only when a condition on another field is met.
   *
   * @example
   * .showWhen('status', 'published')           // equality shorthand
   * .showWhen('views', '>', 100)               // comparison operator
   * .showWhen('status', ['draft', 'review'])   // one of (array → 'in' op)
   * .showWhen('name', 'truthy')                // non-empty / non-null
   */
  showWhen(field: string, opOrValue: ConditionOp | unknown, value?: unknown): this {
    return this._addCondition('show', field, opOrValue, value)
  }

  /**
   * Hide this field when a condition on another field is met.
   */
  hideWhen(field: string, opOrValue: ConditionOp | unknown, value?: unknown): this {
    return this._addCondition('hide', field, opOrValue, value)
  }

  /**
   * Show the field but make it readonly (disabled) when the condition is met.
   * Inspired by FilamentPHP's `.disabled(fn)`.
   */
  disabledWhen(field: string, opOrValue: ConditionOp | unknown, value?: unknown): this {
    return this._addCondition('disabled', field, opOrValue, value)
  }

  private _addCondition(
    type: 'show' | 'hide' | 'disabled',
    field: string,
    opOrValue: ConditionOp | unknown,
    value?: unknown,
  ): this {
    const ops: ConditionOp[] = ['=','!=','>','>=','<','<=','in','not_in','truthy','falsy']
    if (Array.isArray(opOrValue)) {
      this._conditions.push({ type, field, op: 'in', value: opOrValue })
    } else if (opOrValue === 'truthy' || opOrValue === 'falsy') {
      this._conditions.push({ type, field, op: opOrValue, value: null })
    } else if (typeof opOrValue === 'string' && (ops as string[]).includes(opOrValue) && value !== undefined) {
      this._conditions.push({ type, field, op: opOrValue as ConditionOp, value })
    } else {
      // shorthand: .showWhen('status', 'published')  → op='='
      this._conditions.push({ type, field, op: '=', value: opOrValue })
    }
    return this
  }

  // ── Getters ────────────────────────────────────────────

  getName():       string  { return this._name }
  isRequired():    boolean { return this._required }
  isReadonly():    boolean { return this._readonly }
  isSortable():    boolean { return this._sortable }
  isSearchable():  boolean { return this._searchable }

  getLabel(): string {
    if (this._label) return this._label
    // title-case the field name: camelCase → 'Camel Case'
    return this._name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (s) => s.toUpperCase())
      .trim()
  }

  isHiddenFrom(view: FieldVisibility): boolean {
    return this._hidden.has(view)
  }

  /** @internal — serialized for the meta endpoint */
  abstract getType(): string

  toMeta(): FieldMeta {
    const meta: FieldMeta = {
      name:       this._name,
      type:       this.getType(),
      label:      this.getLabel(),
      required:   this._required,
      readonly:   this._readonly,
      sortable:   this._sortable,
      searchable: this._searchable,
      hidden:     [...this._hidden],
      extra:      this._extra,
    }
    if (this._component !== undefined) meta.component = this._component
    if (this._conditions.length > 0)   meta.conditions = this._conditions
    return meta
  }
}
