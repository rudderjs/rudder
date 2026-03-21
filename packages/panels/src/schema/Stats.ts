// ─── Stats schema element ───────────────────────────────────

import type { PanelContext } from '../types.js'

export interface PanelStatMeta {
  label:        string
  value:        number | string
  description?: string
  trend?:       number
}

export interface StatsElementMeta {
  type:          'stats'
  id?:           string
  stats:         PanelStatMeta[]
  lazy?:         boolean
  pollInterval?: number
  live?:         boolean
}

export class Stat {
  private _label:        string
  private _value:        number | string = 0
  private _description?: string
  private _trend?:       number

  protected constructor(label: string) {
    this._label = label
  }

  static make(label: string): Stat {
    return new Stat(label)
  }

  value(v: number | string): this {
    this._value = v
    return this
  }

  description(d: string): this {
    this._description = d
    return this
  }

  trend(t: number): this {
    this._trend = t
    return this
  }

  toMeta(): PanelStatMeta {
    return {
      label: this._label,
      value: this._value,
      ...(this._description !== undefined && { description: this._description }),
      ...(this._trend       !== undefined && { trend:       this._trend }),
    }
  }
}

export class Stats {
  private _stats: Stat[] = []
  private _dataFn?: (ctx: PanelContext) => Promise<PanelStatMeta[]>
  private _lazy = false
  private _live = false
  private _pollInterval?: number
  private _id?: string

  protected constructor() {}

  /**
   * Create a Stats element.
   * Accepts either static Stat[] or a string ID (for async data mode).
   *
   * @example
   * // Static:
   * Stats.make([Stat.make('Users').value(42)])
   *
   * // Async:
   * Stats.make('dashboard-stats')
   *   .data(async (ctx) => [
   *     { label: 'Users', value: await User.query().count() },
   *     { label: 'Posts', value: await Post.query().count() },
   *   ])
   *   .poll(60000)
   */
  static make(statsOrId?: Stat[] | string): Stats {
    const instance = new Stats()
    if (Array.isArray(statsOrId)) instance._stats = statsOrId
    else if (typeof statsOrId === 'string') instance._id = statsOrId
    return instance
  }

  /** Set static stats (alternative to passing in constructor). */
  stats(stats: Stat[]): this {
    this._stats = stats
    return this
  }

  /** Async data function — returns stat values dynamically. Overrides static stats on resolution. */
  data(fn: (ctx: PanelContext) => Promise<PanelStatMeta[]>): this {
    this._dataFn = fn
    return this
  }

  /** Unique ID. Required for lazy/poll stats (API endpoint needs it). Auto-generated if not set. */
  id(id: string): this {
    this._id = id
    return this
  }

  /** Defer data loading to client-side. Shows skeleton stat cards on initial render. */
  lazy(): this {
    this._lazy = true
    return this
  }

  /** Enable real-time updates via WebSocket. */
  live(): this {
    this._live = true
    return this
  }

  /** Re-fetch stats every N milliseconds. */
  poll(ms: number): this {
    this._pollInterval = ms
    return this
  }

  getId(): string {
    return this._id ?? 'stats-' + this._stats.map(s => s.toMeta().label).join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  }

  getDataFn(): ((ctx: PanelContext) => Promise<PanelStatMeta[]>) | undefined { return this._dataFn }
  isLazy(): boolean { return this._lazy }
  isLive(): boolean { return this._live }
  getPollInterval(): number | undefined { return this._pollInterval }
  getStats(): Stat[] { return this._stats }
  getType(): 'stats' { return 'stats' }

  toMeta(): StatsElementMeta {
    const meta: StatsElementMeta = {
      type: 'stats',
      stats: this._stats.map(s => s.toMeta()),
    }
    const id = this._id ?? (this._dataFn || this._lazy || this._pollInterval ? this.getId() : undefined)
    if (id) meta.id = id
    if (this._lazy) meta.lazy = true
    if (this._pollInterval !== undefined) meta.pollInterval = this._pollInterval
    if (this._live) meta.live = true
    return meta
  }
}
