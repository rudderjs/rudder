import type { PanelContext } from './types.js'

// ─── Schema definition (same pattern as Panel.schema()) ─────

type PageSchemaElement = { getType(): string }

type PageSchemaDefinition =
  | PageSchemaElement[]
  | ((ctx: PanelContext) => PageSchemaElement[] | Promise<PageSchemaElement[]>)

// ─── Page meta (for UI / meta endpoint) ────────────────────

export interface PageMeta {
  slug:       string
  label:      string
  icon:       string | undefined
  hasSchema:  boolean
}

// ─── Page base class ────────────────────────────────────────

export class Page {
  /** URL slug (e.g. 'analytics'). Derived from class name if not set. */
  static slug?: string

  /** Sidebar label (e.g. 'Analytics'). Derived from class name if not set. */
  static label?: string

  /** Optional icon string shown in the sidebar. */
  static icon?: string

  /** Schema definition — renders the page from schema elements (no Vike page needed). */
  protected static _schema?: PageSchemaDefinition

  /**
   * Define the page content using schema elements.
   * When set, the page renders from schema (SSR) without needing a Vike +Page.tsx file.
   *
   * @example
   * static {
   *   this.schema(async (ctx) => [
   *     Heading.make('Analytics'),
   *     Stats.make([Stat.make('Users').value(await User.query().count())]),
   *     Chart.make('Traffic').chartType('area').labels([...]).datasets([...]),
   *   ])
   * }
   */
  static schema(def: PageSchemaDefinition): typeof Page {
    this._schema = def
    return this
  }

  // ── Static helpers ──────────────────────────────────────

  static getSlug(): string {
    if (this.slug) return this.slug
    // AnalyticsPage → analytics, SettingsPage → settings
    return this.name.replace(/Page$/, '').toLowerCase()
  }

  static getLabel(): string {
    if (this.label) return this.label
    const name = this.name.replace(/Page$/, '')
    return name.replace(/([A-Z])/g, ' $1').trim()
  }

  static getSchema(): PageSchemaDefinition | undefined {
    return this._schema
  }

  static hasSchema(): boolean {
    return this._schema !== undefined
  }

  /** @internal */
  static toMeta(): PageMeta {
    return {
      slug:      this.getSlug(),
      label:     this.getLabel(),
      icon:      this.icon,
      hasSchema: this.hasSchema(),
    }
  }
}
