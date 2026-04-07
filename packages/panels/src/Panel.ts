import type { PanelGuard, BrandingOptions, PanelLayout, PanelContext } from './types.js'
import type { Resource, ResourceMeta } from './Resource.js'
import type { Page, PageMeta } from './Page.js'
import type { Global, GlobalMeta } from './Global.js'
import { getPanelI18n, getPanelDir, getActiveLocale } from './i18n/index.js'
import type { PanelI18n } from './i18n/index.js'
import type { PanelThemeConfig, PanelThemeMeta } from './theme/types.js'
import { resolveTheme } from './theme/resolve.js'
import { ThemeSettingsPage } from './ThemeSettingsPage.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PanelMiddlewareHandler = (...args: any[]) => any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppLike = { make(key: string): any; register(provider: any): any }

/**
 * A panel plugin — extends a panel with extra behavior (routes, schema, etc.).
 *
 * Plugins receive the panel they're attached to, so they can mount routes
 * scoped to that panel and read its configuration.
 *
 * @example
 * ```ts
 * Panel.make('admin')
 *   .use(media({ conversions: [...] }))
 *   .use(activityLog())
 * ```
 */
export interface PanelPluginSchema {
  from: string
  to:   string
  tag:  string
  orm?: 'prisma' | 'drizzle'
  driver?: 'sqlite' | 'postgresql' | 'mysql'
}

export interface PanelPlugin {
  /** Prisma/Drizzle schema files to publish. PanelServiceProvider handles the actual publishing. */
  schemas?: PanelPluginSchema[]
  /** Pages directory to publish (relative to the plugin's package). */
  pages?: string
  /** SSR resolvers for custom schema element types. Keyed by element type. */
  resolvers?: Record<string, (el: unknown, ctx: unknown) => Promise<unknown>>
  /** Called during PanelServiceProvider.register() — bind DI, etc. */
  register?(panel: Panel, app: AppLike): void
  /** Called during PanelServiceProvider.boot() — mount routes, etc. */
  boot?(panel: Panel, app: AppLike): void | Promise<void>
}

type PanelSchemaElement = { getType(): string }

type PanelSchemaDefinition =
  | PanelSchemaElement[]
  | ((ctx: PanelContext) => PanelSchemaElement[] | Promise<PanelSchemaElement[]>)

// ─── Panel meta (for UI / meta endpoint) ───────────────────

/** Slim resource info for sidebar navigation — no fields/columns/actions. */
export interface ResourceNavigationMeta {
  label:       string
  labelSingular: string
  slug:        string
  icon?:       string | undefined
  navigationGroup?: string | undefined
  navigationBadgeColor?: 'gray' | 'primary' | 'success' | 'warning' | 'danger' | undefined
}

/** Slim global info for sidebar navigation. */
export interface GlobalNavigationMeta {
  label:  string
  slug:   string
  icon?:  string | undefined
}

/** Slim panel meta for layout/sidebar — no full resource definitions. */
export interface PanelNavigationMeta {
  name:      string
  path:      string
  branding:  BrandingOptions
  resources: ResourceNavigationMeta[]
  globals:   GlobalNavigationMeta[]
  pages:     PageMeta[]
  layout:    PanelLayout
  locale:    string
  dir:       'ltr' | 'rtl'
  /** Merged i18n strings (bundled defaults + any `lang/<locale>/panels.json` overrides). Resolved on the server so the client doesn't need access to the localization cache. */
  i18n:      PanelI18n
  /** Resolved theme — CSS variables, fonts, radius. Undefined = use app CSS defaults. */
  theme?:    PanelThemeMeta
}

/** Full panel meta — includes complete resource/global definitions. */
export interface PanelMeta {
  name:      string
  path:      string
  branding:  BrandingOptions
  resources: ResourceMeta[]
  globals:   GlobalMeta[]
  pages:     PageMeta[]
  layout:    PanelLayout
  locale:    string
  dir:       'ltr' | 'rtl'
  i18n:      PanelI18n
  /** Resolved theme — CSS variables, fonts, radius. Undefined = use app CSS defaults. */
  theme?:    PanelThemeMeta
}

// ─── Panel builder ─────────────────────────────────────────

export class Panel {
  protected _name:      string
  protected _path:      string
  protected _guard?:    PanelGuard
  protected _branding:  BrandingOptions = {}
  protected _resources: (typeof Resource)[] = []
  protected _globals:   (typeof Global)[] = []
  protected _pages:     (typeof Page)[] = []
  protected _layout:    PanelLayout = 'sidebar'
  protected _locale?:   string
  protected _schema?:   PanelSchemaDefinition
  protected _middleware: PanelMiddlewareHandler[] = []
  protected _plugins:   PanelPlugin[] = []
  protected _theme?:    PanelThemeConfig
  protected _themeOverrides?: Partial<PanelThemeConfig>
  protected _themeEditor = false
  protected _notifications: { enabled: boolean; pollInterval: number } = { enabled: false, pollInterval: 30000 }

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

  /**
   * Middleware applied to all panel API routes.
   * Use this to add SessionMiddleware, CSRF, etc.
   *
   * @example
   * Panel.make('admin')
   *   .middleware([SessionMiddleware()])
   */
  middleware(handlers: PanelMiddlewareHandler[]): this {
    this._middleware = handlers
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

  /**
   * Override the locale for this panel's UI strings and text direction.
   * Defaults to the locale configured in @rudderjs/localization (or 'en').
   *
   * @example
   * Panel.make('admin').locale('ar')
   */
  locale(locale: string): this {
    this._locale = locale
    return this
  }

  /** Resource classes to register in this panel. */
  resources(list: (typeof Resource)[]): this {
    this._resources = list
    return this
  }

  /** Global (single-record) classes to register in this panel. */
  globals(list: (typeof Global)[]): this {
    this._globals = list
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

  /**
   * Register a plugin for this panel.
   * Plugins extend the panel with extra behavior — routes, pages, schema, etc.
   *
   * @example
   * Panel.make('admin')
   *   .use(media({ conversions: [{ name: 'thumb', width: 200, format: 'webp' }] }))
   */
  use(plugin: PanelPlugin): this {
    this._plugins.push(plugin)
    return this
  }

  /**
   * Configure the panel's visual theme — colors, fonts, radius, and more.
   * Theme CSS variables are injected at runtime, overriding the app's defaults.
   *
   * @example
   * Panel.make('admin').theme({
   *   preset: 'nova',
   *   baseColor: 'zinc',
   *   accentColor: 'blue',
   *   radius: 'medium',
   *   fonts: { heading: 'Space Grotesk', body: 'Inter' },
   * })
   */
  theme(config: PanelThemeConfig): this {
    this._theme = config
    return this
  }

  /**
   * Enable the built-in theme editor page.
   * Adds a "Theme" page to the panel sidebar under Settings.
   *
   * @example
   * Panel.make('admin').theme({ preset: 'nova' }).themeEditor()
   */
  themeEditor(enabled = true): this {
    this._themeEditor = enabled
    return this
  }

  /**
   * Set runtime theme overrides (loaded from DB by PanelServiceProvider).
   * @internal
   */
  setThemeOverrides(overrides: Partial<PanelThemeConfig> | null | undefined): void {
    if (overrides) {
      this._themeOverrides = overrides
    } else {
      delete this._themeOverrides
    }
  }

  /** @internal */
  hasThemeEditor(): boolean { return this._themeEditor }

  /**
   * Enable in-app notifications widget (bell icon with dropdown).
   * Requires `@rudderjs/notification` with a database store.
   *
   * @example
   * Panel.make('admin').notifications()
   * Panel.make('admin').notifications({ pollInterval: 15000 })
   */
  notifications(config: { pollInterval?: number } | boolean = true): this {
    if (typeof config === 'boolean') {
      this._notifications = { enabled: config, pollInterval: 30000 }
    } else {
      this._notifications = { enabled: true, pollInterval: config.pollInterval ?? 30000 }
    }
    return this
  }

  /** @internal */
  hasNotifications(): boolean { return this._notifications.enabled }
  /** @internal */
  getNotificationsConfig(): { enabled: boolean; pollInterval: number } { return this._notifications }

  // ── Getters ─────────────────────────────────────────────

  getName(): string { return this._name }
  getPath(): string { return this._path }
  getGuard(): PanelGuard | undefined { return this._guard }
  getMiddleware(): PanelMiddlewareHandler[] { return this._middleware }
  getBranding(): BrandingOptions { return this._branding }
  getResources(): (typeof Resource)[] { return this._resources }
  getGlobals(): (typeof Global)[] { return this._globals }
  getPages(): (typeof Page)[] { return this._pages }

  /** Get all pages including nested sub-pages and built-in pages (flat list). Sub-page slugs are prefixed with parent slug. */
  getAllPages(): (typeof Page)[] {
    const result: (typeof Page)[] = []
    function collect(pages: (typeof Page)[], parentSlug?: string) {
      for (const P of pages) {
        if (parentSlug) {
          // Create a proxy with the full slug
          const fullSlug = `${parentSlug}/${P.getSlug()}`
          const ProxyPage = Object.create(P) as typeof Page
          Object.defineProperty(ProxyPage, 'slug', { value: fullSlug, writable: true })
          // Preserve static methods by delegating
          result.push(ProxyPage)
        } else {
          result.push(P)
        }
        if (P.pages.length > 0) {
          const pSlug = parentSlug ? `${parentSlug}/${P.getSlug()}` : P.getSlug()
          collect(P.pages, pSlug)
        }
      }
    }
    collect(this._allPagesWithBuiltins())
    return result
  }
  getPlugins(): PanelPlugin[] { return this._plugins }
  getTheme(): PanelThemeConfig | undefined { return this._theme }
  /** Get the merged theme config (code defaults + DB overrides). */
  getMergedTheme(): PanelThemeConfig | undefined { return this._mergedTheme() }
  getLayout(): PanelLayout { return this._layout }

  /** Pages + built-in pages (e.g. ThemeSettingsPage when themeEditor is enabled). */
  private _allPagesWithBuiltins(): (typeof Page)[] {
    const pages = [...this._pages]
    if (this._themeEditor) pages.push(ThemeSettingsPage)
    return pages
  }

  /** Merge code defaults + DB overrides into a single config for resolution. */
  private _mergedTheme(): PanelThemeConfig | undefined {
    if (!this._theme) return undefined
    if (!this._themeOverrides) return this._theme
    return {
      ...this._theme,
      ...this._themeOverrides,
      fonts: { ...this._theme.fonts, ...this._themeOverrides.fonts },
    }
  }
  getSchema(): PanelSchemaDefinition | undefined { return this._schema }
  hasSchema(): boolean { return this._schema !== undefined }

  /** Base path for the auto-generated API routes (e.g. '/admin/api'). */
  getApiBase(): string { return `${this._path}/api` }

  /** @internal */
  /** Slim meta for layout/sidebar — no full resource definitions. */
  toNavigationMeta(): PanelNavigationMeta {
    const locale = this._locale ?? getActiveLocale()
    return {
      name:      this._name,
      path:      this._path,
      branding:  this._branding,
      resources: this._resources.map((R) => {
        const meta: ResourceNavigationMeta = {
          label:          R.label ?? R.name.replace(/Resource$/, ''),
          labelSingular:  R.labelSingular ?? R.label ?? R.name.replace(/Resource$/, ''),
          slug:           R.getSlug(),
        }
        if (R.icon)                 meta.icon = R.icon
        if (R.navigationGroup)      meta.navigationGroup = R.navigationGroup
        if (R.navigationBadgeColor) meta.navigationBadgeColor = R.navigationBadgeColor
        return meta
      }),
      globals:   this._globals.map((G) => {
        const meta: GlobalNavigationMeta = {
          label:  G.label ?? G.name.replace(/Global$/, ''),
          slug:   G.getSlug(),
        }
        if (G.icon) meta.icon = G.icon
        return meta
      }),
      pages:     this._allPagesWithBuiltins().map((P) => P.toMeta()),
      layout:    this._layout,
      locale,
      dir:       getPanelDir(locale),
      i18n:      getPanelI18n(locale),
      ...(this._theme ? { theme: resolveTheme(this._mergedTheme()!) } : {}),
    }
  }

  /** Full meta — includes complete resource/global definitions. */
  toMeta(): PanelMeta {
    const locale = this._locale ?? getActiveLocale()
    return {
      name:      this._name,
      path:      this._path,
      branding:  this._branding,
      resources: this._resources.map((R) => new R().toMeta()),
      globals:   this._globals.map((G) => new G().toMeta()),
      pages:     this._allPagesWithBuiltins().map((P) => P.toMeta()),
      layout:    this._layout,
      locale,
      dir:       getPanelDir(locale),
      i18n:      getPanelI18n(locale),
      ...(this._theme ? { theme: resolveTheme(this._mergedTheme()!) } : {}),
    }
  }

}
