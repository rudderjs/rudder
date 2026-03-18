import type { Field, FieldMeta } from './Field.js'
import type { Filter } from './Filter.js'
import type { Action } from './Action.js'
import type { Tab, ListTabMeta } from './Tab.js'
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
  tabs:           ListTabMeta[]
  actions:        ReturnType<Action['toMeta']>[]
  defaultSort?:      string
  defaultSortDir?:   'ASC' | 'DESC'
  titleField?:       string
  rememberTable:    boolean
  draftRecovery:    boolean
  autosave:             boolean
  autosaveInterval:     number
  perPage:           number
  perPageOptions:    number[]
  paginationType:    'pagination' | 'loadMore'
  live:              boolean
  versioned:         boolean
  draftable:         boolean
  yjs:               boolean
  softDeletes:       boolean
  navigationGroup?: string
  navigationBadgeColor?: 'gray' | 'primary' | 'success' | 'warning' | 'danger'
  emptyStateIcon?: string
  emptyStateHeading?: string
  emptyStateDescription?: string
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
   * Remember table state (filters, sort, search, page, selected rows) in sessionStorage.
   * When true, navigating away and back restores the previous table state.
   */
  static rememberTable = false

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
   * Enable version history for this resource.
   * Each save/publish creates a JSON snapshot in the PanelVersion table.
   * Users can view past versions and revert to any snapshot.
   * Does NOT require Yjs — works with plain JSON snapshots.
   */
  static versioned = false

  /**
   * Enable draft/publish workflow for this resource.
   * Records have a `_status` field ('draft' | 'published').
   * Create saves as draft by default. "Publish" makes it live.
   * Requires a `_status String @default("draft")` column on the model's table.
   */
  static draftable = false

  /**
   * Enable form draft recovery via localStorage.
   * When true, form values are backed up to localStorage as the user types.
   * On page reload or crash, a restore banner offers to recover the draft.
   * Applies to both create and edit pages.
   */
  static draftRecovery = false

  /**
   * Enable automatic saving of form changes to the server.
   * When true, the edit page periodically saves changes via PUT without
   * requiring the user to click Save. A status indicator shows save state.
   * Only applies to the edit page (create requires explicit submission).
   */
  static autosave: boolean | { interval?: number } = false

  /** Default autosave interval in milliseconds. */
  static autosaveInterval = 30000

  /**
   * Enable soft deletes for this resource.
   * When true, deleting a record sets `deletedAt` instead of removing it.
   * Soft-deleted records are hidden from the list by default but can be
   * viewed via the trash toggle. Supports restore and force-delete actions.
   * Requires a `deletedAt DateTime?` column on the model's table.
   */
  static softDeletes = false

  /** Navigation group label — resources with the same group are grouped in the sidebar. */
  static navigationGroup?: string

  /**
   * Navigation badge — async function that returns a count or label for the sidebar badge.
   * Called on each page load. Return `null` or `undefined` to hide the badge.
   */
  static navigationBadge?: () => Promise<string | number | null | undefined>

  /**
   * Navigation badge color — Tailwind color name.
   * Options: 'gray' | 'primary' | 'success' | 'warning' | 'danger'
   */
  static navigationBadgeColor?: 'gray' | 'primary' | 'success' | 'warning' | 'danger'

  /** Custom empty state icon — emoji or short string. Default: '📭' */
  static emptyStateIcon?: string

  /** Custom empty state heading. Supports `:label` placeholder. */
  static emptyStateHeading?: string

  /** Custom empty state description. */
  static emptyStateDescription?: string

  // ── Abstract / overridable ──────────────────────────────

  /** Define the fields (and optional Section / Tabs groupings) for this resource. Required. */
  fields(): FieldOrGrouping[] {
    throw new Error(`[BoostKit Panels] Resource "${this.constructor.name}" must implement fields().`)
  }

  /** Define table filters. */
  filters(): Filter[] { return [] }

  /** Define tab filters for the list view (e.g. All / Published / Draft). */
  tabs(): Tab[] { return [] }

  /** Define record actions (bulk or single). */
  actions(): Action[] { return [] }

  /**
   * Define widgets shown on the resource show page.
   * Receives the current record for data-driven widgets.
   * Returns schema elements (Stats, Chart, List, Table, etc.)
   */
  widgets(_record?: Record<string, unknown>): { getType(): string; toMeta(): unknown }[] { return [] }

  /**
   * Authorization policy.
   * Return false to deny the action — the API responds with 403.
   * Defaults to allowing everything.
   */
   
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
    const fieldItems = this.fields()
    const fieldsMeta = fieldItems.map((f) => f.toMeta()) as SchemaItemMeta[]

    // Derive yjs from fields — true if any field needs a Y.Doc
    const hasYjsField = fieldItems.some((item) => {
      if ('getFields' in item) {
        return (item as { getFields(): Field[] }).getFields().some((f) => f.isYjs())
      }
      return (item as Field).isYjs()
    })

    const meta: ResourceMeta = {
      label:         Cls.getLabel(),
      labelSingular: Cls.getLabelSingular(),
      slug:          Cls.getSlug(),
      icon:          Cls.icon,
      fields:        fieldsMeta,
      filters:       this.filters().map((f) => f.toMeta()),
      tabs:          this.tabs().map((t) => t.toMeta()),
      actions:       this.actions().map((a) => a.toMeta()),
      rememberTable:  Cls.rememberTable,
      draftRecovery:  Cls.draftRecovery,
      autosave:           typeof Cls.autosave === 'object' ? true : !!Cls.autosave,
      autosaveInterval:   typeof Cls.autosave === 'object' && Cls.autosave.interval
                            ? Cls.autosave.interval
                            : Cls.autosaveInterval,
      perPage:         Cls.perPage,
      perPageOptions:  Cls.perPageOptions,
      paginationType:  Cls.paginationType,
      live:            Cls.live,
      versioned:       Cls.versioned,
      draftable:       Cls.draftable,
      yjs:             hasYjsField,
      softDeletes:     Cls.softDeletes,
    }
    if (Cls.defaultSort    !== undefined) meta.defaultSort    = Cls.defaultSort
    if (Cls.defaultSortDir !== undefined) meta.defaultSortDir = Cls.defaultSortDir
    if (Cls.titleField     !== undefined) meta.titleField     = Cls.titleField
    if (Cls.navigationGroup)       meta.navigationGroup       = Cls.navigationGroup
    if (Cls.navigationBadgeColor)  meta.navigationBadgeColor  = Cls.navigationBadgeColor
    if (Cls.emptyStateIcon)        meta.emptyStateIcon        = Cls.emptyStateIcon
    if (Cls.emptyStateHeading)     meta.emptyStateHeading     = Cls.emptyStateHeading
    if (Cls.emptyStateDescription) meta.emptyStateDescription = Cls.emptyStateDescription
    return meta
  }
}
