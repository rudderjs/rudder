import type { PanelGuard, BrandingOptions, PanelLayout, PanelContext } from './types.js'
import type { Resource, ResourceMeta } from './Resource.js'
import type { Page, PageMeta } from './Page.js'

type PanelSchemaElement = { getType(): string }

type PanelSchemaDefinition =
  | PanelSchemaElement[]
  | ((ctx: PanelContext) => PanelSchemaElement[] | Promise<PanelSchemaElement[]>)

// ─── Panel meta (for UI / meta endpoint) ───────────────────

export interface PanelMeta {
  name:      string
  path:      string
  branding:  BrandingOptions
  resources: ResourceMeta[]
  pages:     PageMeta[]
  layout:    PanelLayout
}

// ─── Panel builder ─────────────────────────────────────────

export class Panel {
  protected _name:      string
  protected _path:      string
  protected _guard?:    PanelGuard
  protected _branding:  BrandingOptions = {}
  protected _resources: (typeof Resource)[] = []
  protected _pages:     (typeof Page)[] = []
  protected _layout:    PanelLayout = 'sidebar'
  protected _schema?:   PanelSchemaDefinition

  protected constructor(name: string) {
    this._name = name
    this._path = `/${name}`
  }

  /** Create a new panel with the given identifier. */
  static make(name: string): Panel {
    return new Panel(name)
  }

  // ── Fluent configuration ────────────────────────────────

  /** URL prefix for all pages and API routes in this panel (e.g. '/admin'). */
  path(path: string): this {
    this._path = path.startsWith('/') ? path : `/${path}`
    return this
  }

  /**
   * Auth guard — runs before every request to this panel.
   * Return false (or resolve to false) to reject with 401.
   *
   * @example
   * .guard(async (ctx) => ctx.user?.role === 'admin')
   */
  guard(fn: PanelGuard): this {
    this._guard = fn
    return this
  }

  /** Display settings shown in the panel UI. */
  branding(opts: BrandingOptions): this {
    this._branding = { ...this._branding, ...opts }
    return this
  }

  /** Custom pages to register in this panel (appear in sidebar/topbar nav). */
  pages(list: (typeof Page)[]): this {
    this._pages = list
    return this
  }

  /** Layout style for the panel UI. */
  layout(type: PanelLayout): this {
    this._layout = type
    return this
  }

  /** Resource classes to register in this panel. */
  resources(list: (typeof Resource)[]): this {
    this._resources = list
    return this
  }

  /**
   * Define the panel landing page schema.
   * Accepts a static array of elements or an async function receiving the
   * PanelContext (includes the authenticated user).
   *
   * When a schema is defined, visiting the panel root renders it instead of
   * redirecting to the first resource.
   *
   * @example
   * .schema(async (ctx) => [
   *   Heading.make(`Welcome, ${ctx.user?.name ?? 'Guest'}`),
   *   Stats.make([
   *     Stat.make('Articles').value(await Article.query().count()),
   *   ]),
   * ])
   */
  schema(def: PanelSchemaDefinition): this {
    this._schema = def
    return this
  }

  // ── Getters ─────────────────────────────────────────────

  getName(): string { return this._name }
  getPath(): string { return this._path }
  getGuard(): PanelGuard | undefined { return this._guard }
  getBranding(): BrandingOptions { return this._branding }
  getResources(): (typeof Resource)[] { return this._resources }
  getPages(): (typeof Page)[] { return this._pages }
  getLayout(): PanelLayout { return this._layout }
  getSchema(): PanelSchemaDefinition | undefined { return this._schema }
  hasSchema(): boolean { return this._schema !== undefined }

  /** Base path for the auto-generated API routes (e.g. '/admin/api'). */
  getApiBase(): string { return `${this._path}/api` }

  /** @internal */
  toMeta(): PanelMeta {
    return {
      name:      this._name,
      path:      this._path,
      branding:  this._branding,
      resources: this._resources.map((R) => new R().toMeta()),
      pages:     this._pages.map((P) => P.toMeta()),
      layout:    this._layout,
    }
  }
}
