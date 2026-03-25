import type { MediaRecord } from '../types.js'
import { getLibrary, getDefaultLibrary, type MediaLibrary } from '../registry.js'

export interface MediaConversion {
  name:    string
  width:   number
  height?: number
  crop?:   boolean
  format?: 'webp' | 'jpeg' | 'png' | 'avif'
  quality?: number
}

export interface MediaElementMeta {
  type:           'media'
  id:             string
  title:          string
  libraries:      Array<{ name: string } & MediaLibrary>
  activeLibrary:  string
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
  private _libraries:      string[] = []
  private _scope:          'shared' | 'private' = 'shared'
  private _height?:        number
  private _lazy            = false
  private _pollInterval?:  number
  private _parentId:       string | null = null
  private _dataFn?:        DataFn

  // Element-level overrides (applied on top of library config)
  private _disk?:          string
  private _directory?:     string
  private _accept?:        string[]
  private _maxUploadSize?: number
  private _conversions?:   MediaConversion[]

  protected constructor(title: string) {
    this._title = title
  }

  static make(title: string): Media {
    return new Media(title)
  }

  id(id: string): this { this._id = id; return this }

  /** Reference one or more named media libraries defined in media() plugin config. */
  library(name: string | string[]): this {
    this._libraries = Array.isArray(name) ? name : [name]
    return this
  }

  /** Override library disk (or set if no library referenced). */
  disk(disk: string): this { this._disk = disk; return this }
  /** Override library directory. */
  directory(dir: string): this { this._directory = dir; return this }
  /** Override library accepted MIME types. */
  accept(mimes: string[]): this { this._accept = mimes; return this }
  /** Override library max upload size. */
  maxUploadSize(bytes: number): this { this._maxUploadSize = bytes; return this }
  /** Override library conversions. */
  conversions(conversions: MediaConversion[]): this { this._conversions = conversions; return this }

  scope(scope: 'shared' | 'private'): this { this._scope = scope; return this }
  height(h: number): this { this._height = h; return this }
  parentId(id: string): this { this._parentId = id; return this }
  lazy(): this { this._lazy = true; return this }
  poll(ms: number): this { this._pollInterval = ms; return this }
  data(fn: DataFn): this { this._dataFn = fn; return this }

  // ── Accessors ──────────────────────────────────────────────

  getId(): string {
    return this._id ?? this._title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  }

  getScope(): 'shared' | 'private' { return this._scope }
  getParentId(): string | null { return this._parentId }
  getDataFn(): DataFn | undefined { return this._dataFn }
  isLazy(): boolean { return this._lazy }
  getPollInterval(): number | undefined { return this._pollInterval }
  getType(): 'media' { return 'media' }

  /** Resolve the active library config (first library or default). */
  getActiveLibrary(): MediaLibrary {
    if (this._libraries.length > 0) {
      const lib = getLibrary(this._libraries[0]!)
      if (lib) return this._applyOverrides(lib)
    }
    return this._applyOverrides(getDefaultLibrary())
  }

  /** Resolve all referenced libraries with overrides applied. */
  getLibraries(): Array<{ name: string } & MediaLibrary> {
    const names = this._libraries.length > 0 ? this._libraries : ['default']
    return names.map(name => {
      const lib = getLibrary(name) ?? getDefaultLibrary()
      return { name, ...this._applyOverrides(lib) }
    })
  }

  private _applyOverrides(lib: MediaLibrary): MediaLibrary {
    const result: MediaLibrary = {
      disk:      this._disk ?? lib.disk,
      directory: this._directory ?? lib.directory,
    }
    const accept = this._accept ?? lib.accept
    if (accept) result.accept = accept
    const maxUploadSize = this._maxUploadSize ?? lib.maxUploadSize
    if (maxUploadSize !== undefined) result.maxUploadSize = maxUploadSize
    const conversions = this._conversions ?? lib.conversions
    if (conversions) result.conversions = conversions
    return result
  }

  toMeta(): MediaElementMeta {
    const libraries = this.getLibraries()
    const meta: MediaElementMeta = {
      type:          'media',
      id:            this.getId(),
      title:         this._title,
      libraries,
      activeLibrary: libraries[0]?.name ?? 'default',
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
