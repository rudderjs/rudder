import type { Field, FieldMeta } from './Field.js'
import type { Filter } from './Filter.js'
import type { Action } from './Action.js'
import type { Section, SectionMeta } from './Section.js'
import type { Tabs, TabsMeta } from './Tabs.js'
import type { PolicyAction, PanelContext, ModelClass } from './types.js'

// ─── Schema item — field, section, or tabs group ───────────

export type FieldOrGrouping = Field | Section | Tabs
export type SchemaItemMeta  = FieldMeta | SectionMeta | TabsMeta

// ─── Resource meta (for UI / meta endpoint) ────────────────

export interface ResourceMeta {
  label:          string
  labelSingular:  string
  slug:           string
  icon:           string | undefined
  fields:         SchemaItemMeta[]
  filters:        ReturnType<Filter['toMeta']>[]
  actions:        ReturnType<Action['toMeta']>[]
  defaultSort?:      string
  defaultSortDir?:   'ASC' | 'DESC'
  titleField?:       string
  persistTableState:    boolean
  perPage:           number
  perPageOptions:    number[]
  paginationType:    'pagination' | 'loadMore'
  live:              boolean
  versioned:         boolean
}

// ─── Resource base class ───────────────────────────────────

export class Resource {
  // ── Static configuration ────────────────────────────────

  /** The model class to bind CRUD operations to. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static model?: ModelClass<any>

  /** Plural display label (e.g. 'Blog Posts'). Derived from class name if not set. */
  static label?: string

  /** Singular display label (e.g. 'Blog Post'). Derived from label if not set. */
  static labelSingular?: string

  /** URL slug (e.g. 'blog-posts'). Derived from class name if not set. */
  static slug?: string

  /** Icon name for the sidebar (optional — any icon library string). */
  static icon?: string

  /** Default sort column (e.g. 'createdAt'). Applied when no ?sort param in URL. */
  static defaultSort?: string
  /** Default sort direction. Applies with defaultSort. */
  static defaultSortDir?: 'ASC' | 'DESC'

  /**
   * The field used as the record's display title in the show page header,
   * breadcrumbs, and anywhere a human-readable label is needed (e.g. 'name', 'title').
   */
  static titleField?: string

  /**
   * Persist table state (filters, sort, search, page, selected rows) in sessionStorage.
   * When true, navigating away and back restores the previous table state.
   */
  static persistTableState = false

  /** Number of records per page. */
  static perPage = 15

  /** Options shown in the per-page dropdown. */
  static perPageOptions = [10, 15, 25, 50, 100]

  /** Pagination style: 'pagination' (numbered pages) or 'loadMore' (append button). */
  static paginationType: 'pagination' | 'loadMore' = 'pagination'

  /**
   * Enable live table updates via WebSocket broadcasting.
   * When true, any CRUD mutation broadcasts to all connected viewers,
   * causing their table to refresh automatically.
   * Uses @boostkit/broadcast — no Yjs required.
   */
  static live = false

  /**
   * Enable Yjs-backed version history for this resource.
   * Each record gets a ydoc that tracks field changes over time.
   * Save = snapshot ydoc + publish field values to DB.
   * Uses @boostkit/live.
   */
  static versioned = false

  // ── Abstract / overridable ──────────────────────────────

  /** Define the fields (and optional Section / Tabs groupings) for this resource. Required. */
  fields(): FieldOrGrouping[] {
    throw new Error(`[BoostKit Panels] Resource "${this.constructor.name}" must implement fields().`)
  }

  /** Define table filters. */
  filters(): Filter[] { return [] }

  /** Define record actions (bulk or single). */
  actions(): Action[] { return [] }

  /**
   * Authorization policy.
   * Return false to deny the action — the API responds with 403.
   * Defaults to allowing everything.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async policy(_action: PolicyAction, _ctx: PanelContext): Promise<boolean> {
    return true
  }

  // ── Static helpers ──────────────────────────────────────

  static getSlug(): string {
    if (this.slug) return this.slug
    const name = this.name.replace(/Resource$/, '')
    const kebab = name
      .replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)
      .replace(/^-/, '')
    // Basic pluralisation: -y → -ies, else append -s
    return kebab.endsWith('y')
      ? kebab.slice(0, -1) + 'ies'
      : kebab + 's'
  }

  static getLabel(): string {
    if (this.label) return this.label
    const name = this.name.replace(/Resource$/, '')
    return name.replace(/([A-Z])/g, ' $1').trim()
  }

  static getLabelSingular(): string {
    if (this.labelSingular) return this.labelSingular
    const label = this.getLabel()
    // Naive singularization — remove trailing 's' if present
    return label.endsWith('s') ? label.slice(0, -1) : label
  }

  // ── Instance meta ───────────────────────────────────────

  /** @internal */
  toMeta(): ResourceMeta {
    const Cls = this.constructor as typeof Resource
    const meta: ResourceMeta = {
      label:         Cls.getLabel(),
      labelSingular: Cls.getLabelSingular(),
      slug:          Cls.getSlug(),
      icon:          Cls.icon,
      fields:        this.fields().map((f) => f.toMeta()) as SchemaItemMeta[],
      filters:       this.filters().map((f) => f.toMeta()),
      actions:       this.actions().map((a) => a.toMeta()),
      persistTableState:  Cls.persistTableState,
      perPage:         Cls.perPage,
      perPageOptions:  Cls.perPageOptions,
      paginationType:  Cls.paginationType,
      live:            Cls.live,
      versioned:       Cls.versioned,
    }
    if (Cls.defaultSort    !== undefined) meta.defaultSort    = Cls.defaultSort
    if (Cls.defaultSortDir !== undefined) meta.defaultSortDir = Cls.defaultSortDir
    if (Cls.titleField     !== undefined) meta.titleField     = Cls.titleField
    return meta
  }
}
