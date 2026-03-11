// ─── Stats schema element ───────────────────────────────────

export interface PanelStatMeta {
  label:        string
  value:        number | string
  description?: string
  trend?:       number
}

export interface StatsElementMeta {
  type:  'stats'
  stats: PanelStatMeta[]
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
  private _stats: Stat[]

  protected constructor(stats: Stat[]) {
    this._stats = stats
  }

  static make(stats: Stat[]): Stats {
    return new Stats(stats)
  }

  getType(): 'stats' { return 'stats' }

  toMeta(): StatsElementMeta {
    return { type: 'stats', stats: this._stats.map((s) => s.toMeta()) }
  }
}
