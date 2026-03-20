import type { Field } from './Field.js'
import type { FieldMeta } from './Field.js'
import type { PersistMode } from './persist.js'

// ─── Persist mode for Tabs ─────────────────────────────────────
export type TabsPersistMode = PersistMode

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
  /** Lucide icon name (optional). */
  icon?: string
  /** Never SSR this tab's content, even if it's the active tab. */
  lazy?: boolean
  /** Badge value — resolved at SSR time. */
  badge?: string | number | null
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
  persist?:   TabsPersistMode
  /** SSR-resolved active tab index (for session/url modes). */
  activeTab?: number
}

// ─── Tab — first-class schema tab ───────────────────────────

export class Tab {
  private _label: string
  private _items: MetaItem[] = []
  private _icon?: string
  private _badge?: (() => Promise<string | number | null>) | string | number
  private _lazy = false

  private constructor(label: string) {
    this._label = label
  }

  static make(label: string): Tab {
    return new Tab(label)
  }

  /** Tab content — fields or schema elements. */
  schema(items: MetaItem[]): this {
    this._items = items
    return this
  }

  /** Lucide icon name. */
  icon(icon: string): this {
    this._icon = icon
    return this
  }

  /** Badge value — static or async function. */
  badge(value: (() => Promise<string | number | null>) | string | number): this {
    this._badge = value
    return this
  }

  /** Never SSR this tab's content, even if it's the active tab. */
  lazy(): this {
    this._lazy = true
    return this
  }

  // ── Getters ──────────────────────────────────────────────

  getLabel(): string { return this._label }
  getItems(): MetaItem[] { return this._items }
  getIcon(): string | undefined { return this._icon }
  getBadge() { return this._badge }
  isLazy(): boolean { return this._lazy }

  /** Get items as Field[] (for resource field context). */
  getFields(): Field[] {
    return this._items.filter(
      (item): item is Field => typeof (item as Record<string, unknown>)['getType'] === 'function' && typeof (item as Record<string, unknown>)['getName'] === 'function'
    )
  }

  /** Check if this tab contains fields (resource context) or schema elements (panel context). */
  hasFields(): boolean { return this._items.length > 0 && this.getFields().length === this._items.length }

  toMeta(): TabMeta {
    const meta: TabMeta = {
      label: this._label,
      fields: [],
    }
    if (this._icon) meta.icon = this._icon
    if (this._lazy) meta.lazy = true

    // Field context — all items are fields with toMeta()
    if (this.hasFields()) {
      meta.fields = this.getFields().map((f) => f.toMeta())
      return meta
    }

    // Schema element context — return label only, elements resolved by resolveSchema
    meta.elements = [] // placeholder — resolveSchema fills this in
    return meta
  }

  /** @internal — resolve async badge value. */
  async resolveBadge(): Promise<string | number | null | undefined> {
    if (this._badge === undefined) return undefined
    if (typeof this._badge === 'function') {
      try { return await this._badge() } catch { return null }
    }
    return this._badge
  }
}

// ─── Tabs class ────────────────────────────────────────────

export class Tabs {
  private _tabs: Tab[] = []
  private _id?: string
  private _persist: TabsPersistMode = false

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

  static make(id?: string, tabs?: Tab[]): Tabs {
    const instance = new Tabs()
    if (id !== undefined) instance._id = id
    if (tabs) instance._tabs = tabs
    return instance
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
    this._tabs.push(Tab.make(label).schema(items))
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

  // ── Persist mode ────────────────────────────────────────────

  /**
   * Control how the active tab is persisted across page loads.
   *
   * - `'localStorage'` — persists in browser localStorage (default when ID is set)
   * - `'url'` — persists in URL query param (shareable, SSR active tab)
   * - `'session'` — persists in server session (SSR active tab, clean URL)
   * - `false` — no persistence, always starts on first tab
   */
  persist(mode: TabsPersistMode = 'localStorage'): this {
    this._persist = mode
    return this
  }

  getPersist(): TabsPersistMode { return this._persist }

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
    if (this._persist !== false) meta.persist = this._persist
    return meta
  }
}
