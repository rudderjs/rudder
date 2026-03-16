// ─── Tab Meta (serialized to client) ────────────────────────

export interface ListTabMeta {
  name:   string
  label:  string
  icon?:  string
}

// ─── Tab Class ──────────────────────────────────────────────

export class Tab {
  private _name:     string
  private _label:    string
  private _icon?:    string
  private _queryFn?: (query: any) => any

  private constructor(name: string) {
    this._name  = name
    this._label = name.charAt(0).toUpperCase() + name.slice(1)
  }

  static make(name: string): Tab {
    return new Tab(name)
  }

  /** Display label for the tab. Defaults to capitalized name. */
  label(label: string): this {
    this._label = label
    return this
  }

  /** Lucide icon name (optional). */
  icon(icon: string): this {
    this._icon = icon
    return this
  }

  /**
   * Modify the query when this tab is active.
   * The "all" tab typically has no query modifier.
   *
   * @example
   * Tab.make('published').query((q) => q.where('status', 'published'))
   */
  query(fn: (query: any) => any): this {
    this._queryFn = fn
    return this
  }

  // ── Internal getters ──────────────────────────────────────

  getName(): string { return this._name }
  getLabel(): string { return this._label }
  getQueryFn(): ((query: any) => any) | undefined { return this._queryFn }

  toMeta(): ListTabMeta {
    const meta: ListTabMeta = {
      name:  this._name,
      label: this._label,
    }
    if (this._icon) meta.icon = this._icon
    return meta
  }
}
