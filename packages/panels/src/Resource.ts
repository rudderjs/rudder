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
  defaultSort?:   string
  defaultSortDir?: 'ASC' | 'DESC'
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
    }
    if (Cls.defaultSort    !== undefined) meta.defaultSort    = Cls.defaultSort
    if (Cls.defaultSortDir !== undefined) meta.defaultSortDir = Cls.defaultSortDir
    return meta
  }
}
