import type { MediaConfig, MediaRecord } from '../types.js'

export interface MediaElementMeta {
  type:           'media'
  id:             string
  title:          string
  disk:           string
  directory:      string
  accept:         string[]
  maxUploadSize:  number
  scope:          'shared' | 'private'
  height?:        number
  items:          MediaRecord[]
  breadcrumbs:    Array<{ id: string; name: string }>
  currentFolder:  MediaRecord | null
  lazy?:          boolean
  pollInterval?:  number
}

interface PanelContext {
  req: unknown
  panelPath: string
  pathSegment: string
}

type DataFn = (ctx: PanelContext) => Promise<{
  items: MediaRecord[]
  breadcrumbs: Array<{ id: string; name: string }>
  currentFolder: MediaRecord | null
}>

export class Media {
  private _title:          string
  private _id?:            string
  private _disk            = 'public'
  private _directory       = 'media'
  private _accept:         string[] = []
  private _maxUploadSize   = 10 * 1024 * 1024
  private _scope:          'shared' | 'private' = 'shared'
  private _height?:        number
  private _lazy            = false
  private _pollInterval?:  number
  private _parentId:       string | null = null
  private _dataFn?:        DataFn
  private _conversions:    MediaConfig['conversions'] = []

  protected constructor(title: string) {
    this._title = title
  }

  static make(title: string): Media {
    return new Media(title)
  }

  id(id: string): this {
    this._id = id
    return this
  }

  disk(disk: string): this {
    this._disk = disk
    return this
  }

  directory(dir: string): this {
    this._directory = dir
    return this
  }

  accept(mimes: string[]): this {
    this._accept = mimes
    return this
  }

  maxUploadSize(bytes: number): this {
    this._maxUploadSize = bytes
    return this
  }

  scope(scope: 'shared' | 'private'): this {
    this._scope = scope
    return this
  }

  height(h: number): this {
    this._height = h
    return this
  }

  parentId(id: string): this {
    this._parentId = id
    return this
  }

  conversions(conversions: NonNullable<MediaConfig['conversions']>): this {
    this._conversions = conversions
    return this
  }

  lazy(): this {
    this._lazy = true
    return this
  }

  poll(ms: number): this {
    this._pollInterval = ms
    return this
  }

  data(fn: DataFn): this {
    this._dataFn = fn
    return this
  }

  // ── Accessors (used by resolver) ────────────────────────────

  getId(): string {
    return this._id ?? this._title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  }

  getDisk(): string { return this._disk }
  getDirectory(): string { return this._directory }
  getAccept(): string[] { return this._accept }
  getMaxUploadSize(): number { return this._maxUploadSize }
  getScope(): 'shared' | 'private' { return this._scope }
  getParentId(): string | null { return this._parentId }
  getConversions(): MediaConfig['conversions'] { return this._conversions }
  getDataFn(): DataFn | undefined { return this._dataFn }
  isLazy(): boolean { return this._lazy }
  getPollInterval(): number | undefined { return this._pollInterval }
  getType(): 'media' { return 'media' }

  toMeta(): MediaElementMeta {
    const meta: MediaElementMeta = {
      type:          'media',
      id:            this.getId(),
      title:         this._title,
      disk:          this._disk,
      directory:     this._directory,
      accept:        this._accept,
      maxUploadSize: this._maxUploadSize,
      scope:         this._scope,
      items:         [],
      breadcrumbs:   [],
      currentFolder: null,
    }
    if (this._height !== undefined) meta.height = this._height
    if (this._lazy) meta.lazy = true
    if (this._pollInterval !== undefined) meta.pollInterval = this._pollInterval
    return meta
  }
}
