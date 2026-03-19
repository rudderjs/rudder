import type { PanelContext } from '../types.js'

export interface ListItem {
  label:        string
  description?: string
  href?:        string
  icon?:        string
}

export interface ListElementMeta {
  type:          'list'
  title:         string
  items:         ListItem[]
  limit:         number
  id?:           string
  description?:  string
  lazy?:         boolean
  pollInterval?: number
}

export class List {
  private _title:        string
  private _items:        ListItem[] = []
  private _limit         = 5
  private _id?:          string
  private _description?: string
  private _lazy          = false
  private _pollInterval?: number
  private _dataFn?:      (ctx: PanelContext) => Promise<ListItem[]>

  protected constructor(title: string) {
    this._title = title
  }

  static make(title: string): List {
    return new List(title)
  }

  items(items: ListItem[]): this {
    this._items = items
    return this
  }

  limit(n: number): this {
    this._limit = n
    return this
  }

  /** Unique ID. Required for lazy/poll lists (API endpoint needs it). Auto-generated from title if not set. */
  id(id: string): this {
    this._id = id
    return this
  }

  /** Optional description displayed below the list title. */
  description(text: string): this {
    this._description = text
    return this
  }

  /** Defer data loading to client-side. Shows skeleton list on initial render. */
  lazy(): this {
    this._lazy = true
    return this
  }

  /** Re-fetch list data every N milliseconds. */
  poll(ms: number): this {
    this._pollInterval = ms
    return this
  }

  /** Async data function — returns list items dynamically. Overrides static items on resolution. */
  data(fn: (ctx: PanelContext) => Promise<ListItem[]>): this {
    this._dataFn = fn
    return this
  }

  getId(): string {
    return this._id ?? this._title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  }

  getDataFn(): ((ctx: PanelContext) => Promise<ListItem[]>) | undefined { return this._dataFn }
  isLazy(): boolean { return this._lazy }
  getPollInterval(): number | undefined { return this._pollInterval }
  getType(): 'list' { return 'list' }

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
    return meta
  }
}
