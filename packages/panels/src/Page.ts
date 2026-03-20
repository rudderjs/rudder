import type { PanelContext } from './types.js'

// ─── Schema definition (stored via define()) ─────────────────

type PageSchemaElement = { getType(): string }

type PageSchemaDefinition =
  | PageSchemaElement[]
  | ((ctx: PanelContext) => PageSchemaElement[] | Promise<PageSchemaElement[]>)

// ─── Page meta (for UI / meta endpoint) ────────────────────

export interface PageMeta {
  slug:              string
  label:             string
  icon:              string | undefined
  hasSchema:         boolean
  navigationParent?: string
  children?:         PageMeta[]
}

// ─── Page base class ────────────────────────────────────────

export class Page {
  /** URL slug (e.g. 'analytics'). Derived from class name if not set. */
  static slug?: string

  /** Sidebar label (e.g. 'Analytics'). Derived from class name if not set. */
  static label?: string

  /** Optional icon string shown in the sidebar. */
  static icon?: string

  /**
   * Sub-pages — structurally nested under this page.
   * Slugs are relative to the parent (e.g. parent 'tables-demo' + child 'pagination' → 'tables-demo/pagination').
   *
   * @example
   * export class TablesDemo extends Page {
   *   static slug = 'tables-demo'
   *   static pages = [PaginationDemo, ExternalDataDemo]
   * }
   */
  static pages: (typeof Page)[] = []

  /**
   * Visual-only sidebar nesting — group this page under another page's label.
   * The page keeps its own slug/URL. Only affects sidebar display.
   *
   * @example
   * export class FormsDemo extends Page {
   *   static slug = 'forms-demo'
   *   static navigationParent = 'Tables Demo'
   * }
   */
  static navigationParent?: string

  /** Stored schema definition — set via define(). */
  protected static _schemaDef?: PageSchemaDefinition

  /**
   * Define the page content using a stored schema definition (array or factory function).
   * Alternative to overriding schema() — useful for inline definitions.
   *
   * @example
   * static {
   *   this.define(async (ctx) => [
   *     Heading.make('Analytics'),
   *     Stats.make([Stat.make('Users').value(await User.query().count())]),
   *   ])
   * }
   */
  static define(def: PageSchemaDefinition): typeof Page {
    this._schemaDef = def
    return this
  }

  /**
   * Return the page's schema elements for the given context.
   *
   * **Override this method** to define the page content with full access to
   * context (params, user, etc.) and async data.
   *
   * @example
   * static async schema({ params, user }) {
   *   return [
   *     Heading.make(`Report #${params.id}`),
   *     Stats.make([Stat.make('Users').value(await User.query().count())]),
   *   ]
   * }
   *
   * The base implementation falls back to a stored definition set via define().
   */
  static async schema(ctx: PanelContext): Promise<PageSchemaElement[]> {
    if (!this._schemaDef) return []
    return typeof this._schemaDef === 'function'
      ? this._schemaDef(ctx)
      : this._schemaDef
  }

  // ── Static helpers ──────────────────────────────────────

  static getSlug(): string {
    if (this.slug) return this.slug
    // AnalyticsPage → analytics, SettingsPage → settings
    return this.name.replace(/Page$/, '').toLowerCase()
  }

  /**
   * Match a URL path against this page's slug pattern and extract route params.
   * Returns an object of extracted params on match, or `null` if no match.
   *
   * Required params:  `:param`  — must be present
   * Optional params:  `:param?` — segment-level only; absent params are omitted
   *
   * @example
   *   slug `orders/:id`            + path `orders/123`       → `{ id: '123' }`
   *   slug `reports/:y/:m`         + path `reports/2025/03`  → `{ y: '2025', m: '03' }`
   *   slug `item-:id`              + path `item-42`          → `{ id: '42' }`
   *   slug `item/:id?`             + path `item`             → `{}`
   *   slug `item/:id?`             + path `item/42`          → `{ id: '42' }`
   *   slug `orders/:id/items/:n?`  + path `orders/1/items`   → `{ id: '1' }`
   *   slug `orders/:id/items/:n?`  + path `orders/1/items/5` → `{ id: '1', n: '5' }`
   */
  static matchPath(urlPath: string): Record<string, string | undefined> | null {
    const segments = this.getSlug().split('/')
    const paramNames: string[] = []
    let regexSource = ''
    let optionalOpen = 0

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i] ?? ''
      const prefix = i === 0 ? '' : '/'

      if (seg.startsWith(':') && seg.endsWith('?') && seg.length > 2) {
        // Optional segment param: :name?
        // Wrap the /segment pair so the slash is also optional
        paramNames.push(seg.slice(1, -1))
        regexSource += `(?:${prefix}([^/]+)`
        optionalOpen++
      } else if (seg.startsWith(':')) {
        // Required param: :name (may appear inline, e.g. item-:id)
        const escaped = seg.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
          .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name: string) => {
            paramNames.push(name)
            return '([^/]+)'
          })
        regexSource += `${prefix}${escaped}`
      } else {
        // Literal segment (may contain inline :param, e.g. item-:id)
        const escaped = seg.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
          .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name: string) => {
            paramNames.push(name)
            return '([^/]+)'
          })
        regexSource += `${prefix}${escaped}`
      }
    }

    // Close all open optional groups (innermost first)
    for (let i = 0; i < optionalOpen; i++) regexSource += ')?'

    const match = urlPath.match(new RegExp(`^${regexSource}$`))
    if (!match) return null

    const params: Record<string, string | undefined> = {}
    paramNames.forEach((name, i) => {
      const val = match[i + 1]
      if (val !== undefined) params[name] = val
    })
    return params
  }

  static getLabel(): string {
    if (this.label) return this.label
    const name = this.name.replace(/Page$/, '')
    return name.replace(/([A-Z])/g, ' $1').trim()
  }

  static hasSchema(): boolean {
    return this._schemaDef !== undefined || this.schema !== Page.schema
  }

  /** @internal */
  static toMeta(parentSlug?: string): PageMeta {
    const ownSlug = this.getSlug()
    const fullSlug = parentSlug ? `${parentSlug}/${ownSlug}` : ownSlug

    const meta: PageMeta = {
      slug:      fullSlug,
      label:     this.getLabel(),
      icon:      this.icon,
      hasSchema: this.hasSchema(),
    }
    if (this.navigationParent) meta.navigationParent = this.navigationParent
    if (this.pages.length > 0) {
      meta.children = this.pages.map(P => P.toMeta(fullSlug))
    }
    return meta
  }
}
