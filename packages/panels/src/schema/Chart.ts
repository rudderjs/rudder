import type { PanelContext } from '../types.js'
import { slugify, applyLazyPollLiveMeta, resolveElementId } from './utils.js'

export type ChartType = 'line' | 'bar' | 'pie' | 'doughnut' | 'area'

export interface ChartDataset {
  label:  string
  data:   number[]
  color?: string
}

export interface ChartDataResult {
  labels:   string[]
  datasets: ChartDataset[]
}

export interface ChartElementMeta {
  type:          'chart'
  title:         string
  chartType:     ChartType
  labels:        string[]
  datasets:      ChartDataset[]
  height:        number
  id?:           string
  description?:  string
  lazy?:         boolean
  pollInterval?: number
  live?:         boolean
}

export class Chart {
  private _title:        string
  private _chartType:    ChartType = 'line'
  private _labels:       string[] = []
  private _datasets:     ChartDataset[] = []
  private _height        = 300
  private _id?:          string
  private _description?: string
  private _lazy          = false
  private _live          = false
  private _pollInterval?: number
  private _dataFn?:      (ctx: PanelContext) => Promise<ChartDataResult>

  protected constructor(title: string) {
    this._title = title
  }

  static make(title: string): Chart {
    return new Chart(title)
  }

  chartType(type: ChartType): this {
    this._chartType = type
    return this
  }

  labels(labels: string[]): this {
    this._labels = labels
    return this
  }

  datasets(datasets: ChartDataset[]): this {
    this._datasets = datasets
    return this
  }

  height(h: number): this {
    this._height = h
    return this
  }

  /** Unique ID. Required for lazy/poll charts (API endpoint needs it). Auto-generated from title if not set. */
  id(id: string): this {
    this._id = id
    return this
  }

  /** Optional description displayed below the chart title. */
  description(text: string): this {
    this._description = text
    return this
  }

  /** Defer data loading to client-side. Shows skeleton chart on initial render. */
  lazy(): this {
    this._lazy = true
    return this
  }

  /** Enable real-time updates via WebSocket. */
  live(): this {
    this._live = true
    return this
  }

  /** Re-fetch chart data every N milliseconds. */
  poll(ms: number): this {
    this._pollInterval = ms
    return this
  }

  /** Async data function — returns labels + datasets dynamically. Overrides static labels/datasets on resolution. */
  data(fn: (ctx: PanelContext) => Promise<ChartDataResult>): this {
    this._dataFn = fn
    return this
  }

  getId(): string {
    return this._id ?? slugify(this._title)
  }

  getDataFn(): ((ctx: PanelContext) => Promise<ChartDataResult>) | undefined { return this._dataFn }
  isLazy(): boolean { return this._lazy }
  isLive(): boolean { return this._live }
  getPollInterval(): number | undefined { return this._pollInterval }
  getType(): 'chart' { return 'chart' }

  toMeta(): ChartElementMeta {
    const meta: ChartElementMeta = {
      type:      'chart',
      title:     this._title,
      chartType: this._chartType,
      labels:    this._labels,
      datasets:  this._datasets,
      height:    this._height,
    }
    const id = resolveElementId(this._id, this.getId(), !!this._dataFn, this)
    if (id) meta.id = id
    if (this._description !== undefined) meta.description = this._description
    applyLazyPollLiveMeta(meta as unknown as Record<string, unknown>, this)
    return meta
  }
}
