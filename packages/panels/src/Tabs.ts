import type { Field } from './Field.js'
import type { FieldMeta } from './Field.js'

// ─── Generic item — any object (fields, schema elements, widgets) ──────
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface MetaItem {}

// ─── Tabs meta (for UI / meta endpoint) ────────────────────

export interface TabMeta {
  label:    string
  fields:   FieldMeta[]
  /** Schema elements (used in Panel.schema() tabs). Undefined when used with fields. */
  elements?: unknown[]
  /** Record ID (model-backed tabs only). */
  id?: string
  /** Full record data (model-backed tabs only). */
  record?: Record<string, unknown>
}

export interface TabsMeta {
  type:       'tabs'
  id?:        string | undefined
  tabs:       TabMeta[]
  creatable?: boolean
  editable?:  boolean
  lazy?:      boolean
  pollInterval?: number
  modelBacked?:  boolean
}

// ─── Tab ───────────────────────────────────────────────────

class Tab {
  constructor(
    private _label: string,
    private _items: MetaItem[] = [],
  ) {}

  getLabel():  string      { return this._label }

  /** Get items as Field[] (for resource field context). */
  getFields(): Field[] {
    return this._items.filter(
      (item): item is Field => typeof (item as Record<string, unknown>)['getType'] === 'function' && typeof (item as Record<string, unknown>)['getName'] === 'function'
    )
  }

  /** Get all raw items. */
  getItems(): MetaItem[] { return this._items }

  /** Check if this tab contains fields (resource context) or schema elements (panel context). */
  hasFields(): boolean { return this._items.length > 0 && this.getFields().length === this._items.length }

  toMeta(): TabMeta {
    // Field context — all items are fields with toMeta()
    if (this.hasFields()) {
      return {
        label:  this._label,
        fields: this.getFields().map((f) => f.toMeta()),
      }
    }

    // Schema element context — return label only, elements resolved by resolveSchema
    return {
      label: this._label,
      fields: [],
      elements: [], // placeholder — resolveSchema fills this in
    }
  }
}

// ─── Tabs class ────────────────────────────────────────────

export class Tabs {
  private _tabs: Tab[] = []
  private _id?: string

  // ── Task 14: Model-backed tabs ─────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _model?: { new(): any; query(): any }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _resourceClass?: { new(): any; getSlug(): string; model?: any }
  private _titleField?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _scope?: (query: any) => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _schemaFn?: (record: any) => MetaItem[]

  // ── Task 15: Creatable / editable ──────────────────────────
  private _creatable = false
  private _editable = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _onCreateFn?: (data: Record<string, unknown>, ctx: any) => Promise<void>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _canCreateFn?: (ctx: any) => boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _canEditFn?: (ctx: any) => boolean

  // ── Task 16: Lazy / poll ───────────────────────────────────
  private _lazy = false
  private _pollInterval?: number

  static make(id?: string): Tabs {
    const tabs = new Tabs()
    if (id !== undefined) tabs._id = id
    return tabs
  }

  getId(): string | undefined { return this._id }

  /**
   * Add a tab with the given label and items.
   * Items can be Field instances (resource forms) or schema elements (panel landing page).
   * Mutually exclusive with `.fromModel()` / `.fromResource()`.
   *
   * @example
   * // Resource fields
   * Tabs.make()
   *   .tab('Content', TextField.make('title'), TextareaField.make('body'))
   *   .tab('SEO', TextField.make('metaTitle'))
   *
   * // Panel schema elements
   * Tabs.make()
   *   .tab('Overview', Stats.make([...]), Chart.make('Revenue')...)
   *   .tab('Activity', Table.make('Recent')..., List.make('Links')...)
   */
  tab(label: string, ...items: MetaItem[]): this {
    this._tabs.push(new Tab(label, items))
    return this
  }

  // ── Task 14: Model-backed methods ──────────────────────────

  /**
   * Generate tabs from model records. Each record becomes a tab.
   * Mutually exclusive with `.tab()`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fromModel(model: { new(): any; query(): any }): this {
    this._model = model
    return this
  }

  /**
   * Generate tabs from a Resource's model. Inherits the model class.
   * Mutually exclusive with `.tab()`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fromResource(resourceClass: { new(): any; getSlug(): string; model?: any }): this {
    this._resourceClass = resourceClass
    this._model = resourceClass.model
    return this
  }

  /** Which model field to use as the tab label. Default: 'name'. */
  title(field: string): this {
    this._titleField = field
    return this
  }

  /** Filter which model records appear as tabs. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scope(fn: (query: any) => any): this {
    this._scope = fn
    return this
  }

  /**
   * Content to render inside each tab — receives the record.
   * For model-backed tabs only.
   *
   * @example
   * Tabs.make('projects')
   *   .fromModel(Project)
   *   .title('name')
   *   .content((record) => [
   *     Stats.make([Stat.make('Tasks').value(record.taskCount)]),
   *     Table.make('Members').fromModel(Member).scope(q => q.where('projectId', record.id)),
   *   ])
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content(fn: (record: any) => MetaItem[]): this {
    this._schemaFn = fn
    return this
  }

  // ── Task 14: Getters ───────────────────────────────────────

  isModelBacked(): boolean { return !!(this._model || this._resourceClass) }
  getModel() { return this._model }
  getResourceClass() { return this._resourceClass }
  getTitleField(): string { return this._titleField ?? 'name' }
  getScope() { return this._scope }
  getContentFn() { return this._schemaFn }

  // ── Task 15: Creatable / editable methods ──────────────────

  /** Show [+] button to create new tabs/records. */
  creatable(): this { this._creatable = true; return this }

  /** Allow renaming/editing tab labels. */
  editable(): this { this._editable = true; return this }

  /** Custom create handler. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCreate(fn: (data: Record<string, unknown>, ctx: any) => Promise<void>): this {
    this._onCreateFn = fn
    return this
  }

  /** Gate who can create tabs. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  canCreate(fn: (ctx: any) => boolean): this {
    this._canCreateFn = fn
    return this
  }

  /** Gate who can edit/rename tabs. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  canEdit(fn: (ctx: any) => boolean): this {
    this._canEditFn = fn
    return this
  }

  // ── Task 15: Getters ──────────────────────────────────────

  isCreatable(): boolean { return this._creatable }
  isEditable(): boolean { return this._editable }
  getOnCreateFn() { return this._onCreateFn }
  getCanCreateFn() { return this._canCreateFn }
  getCanEditFn() { return this._canEditFn }

  // ── Task 16: Lazy / poll methods ──────────────────────────

  /** Defer tab loading to client-side. Shows skeleton tabs on initial render. */
  lazy(): this { this._lazy = true; return this }

  /** Re-fetch tab data every N milliseconds. */
  poll(ms: number): this { this._pollInterval = ms; return this }

  isLazy(): boolean { return this._lazy }
  getPollInterval(): number | undefined { return this._pollInterval }

  // ── Existing methods ──────────────────────────────────────

  /** @internal — flat field list for validation / query building (resource context). */
  getFields(): Field[] { return this._tabs.flatMap((t) => t.getFields()) }

  /** @internal — get raw tabs. */
  getTabs(): Tab[] { return this._tabs }

  getType(): 'tabs' { return 'tabs' }

  /** @internal — serialized for the meta endpoint */
  toMeta(): TabsMeta {
    const meta: TabsMeta = {
      type: 'tabs',
      ...(this._id !== undefined && { id: this._id }),
      tabs:  this._tabs.map((t) => t.toMeta()),
    }
    if (this._creatable) meta.creatable = true
    if (this._editable)  meta.editable  = true
    if (this._lazy)      meta.lazy      = true
    if (this._pollInterval !== undefined) meta.pollInterval = this._pollInterval
    if (this.isModelBacked()) meta.modelBacked = true
    return meta
  }
}
