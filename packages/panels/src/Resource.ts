import type { Field, FieldMeta } from './schema/Field.js'
import type { Section, SectionMeta } from './schema/Section.js'
import type { Tabs, TabsMeta } from './schema/Tabs.js'
import type { PolicyAction, PanelContext, ModelClass } from './types.js'
import type { ResourceAgent } from './agents/ResourceAgent.js'
import type { ResourceAgentMeta } from './agents/types.js'
import { Table } from './schema/Table.js'
import { Form } from './schema/Form.js'

// ─── Schema item — field, section, or tabs group ───────────

export type FieldOrGrouping = Field | Section | Tabs
export type SchemaItemMeta  = FieldMeta | SectionMeta | TabsMeta

// ─── Resource meta (for UI / meta endpoint) ────────────────

export interface ResourceMeta {
  label:          string
  labelSingular:  string
  slug:           string
  fields:         SchemaItemMeta[]
  titleField?:       string
  autosave:             boolean
  autosaveInterval:     number
  live:              boolean
  versioned:         boolean
  draftable:         boolean
  softDeletes:       boolean
  emptyStateIcon?: string | undefined
  emptyStateHeading?: string | undefined
  emptyStateDescription?: string | undefined
  agents?: ResourceAgentMeta[] | undefined
}

// ─── Resource base class ───────────────────────────────────

export class Resource {
  // ── Static identity & navigation ──────────────────────

  /** The model class to bind CRUD operations to. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static model?: ModelClass<any>

  /** Plural display label (e.g. 'Blog Posts'). Derived from class name if not set. */
  static label?: string

  /** Singular display label (e.g. 'Blog Post'). Derived from label if not set. */
  static labelSingular?: string

  /** URL slug (e.g. 'blog-posts'). Derived from class name if not set. */
  static slug?: string

  /** Icon name for the sidebar. */
  static icon?: string

  /** Navigation group label — resources with the same group are grouped in the sidebar. */
  static navigationGroup?: string

  /** Navigation badge — async function returning a count or label for the sidebar. */
  static navigationBadge?: () => Promise<string | number | null | undefined>

  /** Navigation badge color. */
  static navigationBadgeColor?: 'gray' | 'primary' | 'success' | 'warning' | 'danger'

  // ── table() / form() / detail() ───────────────────────

  /**
   * Configure the resource list table.
   * Receives a pre-configured Table with the model already wired.
   *
   * @example
   * table(table: Table) {
   *   return table
   *     .columns([Column.make('title').sortable(), Column.make('status')])
   *     .filters([SelectFilter.make('status').options([...])])
   *     .searchable(['title'])
   *     .softDeletes()
   *     .remember('session')
   * }
   */
  table(table: Table): Table {
    return table
  }

  /**
   * Configure the resource create/edit form.
   * Receives a pre-configured Form with the resource slug as ID.
   *
   * @example
   * form(form: Form) {
   *   return form.fields([
   *     TextField.make('title').required(),
   *     TextareaField.make('body'),
   *   ])
   * }
   */
  form(form: Form): Form {
    return form
  }

  /**
   * Define schema elements for the resource show page.
   *
   * @example
   * detail(record) {
   *   return [
   *     Stats.make([Stat.make('Views').value(record.views)]),
   *   ]
   * }
   */
  detail(_record?: Record<string, unknown>): { getType(): string; toMeta(): unknown }[] {
    return []
  }

  /**
   * Define AI agents that can operate on this resource's records.
   *
   * @example
   * agents() {
   *   return [
   *     ResourceAgent.make('seo')
   *       .label('Improve SEO')
   *       .instructions('Analyse and improve SEO...')
   *       .fields(['title', 'slug', 'metaDescription']),
   *   ]
   * }
   */
  agents(): ResourceAgent[] {
    return []
  }

  /** Authorization policy. Return false to deny — API responds 403. */
  async policy(_action: PolicyAction, _ctx: PanelContext): Promise<boolean> {
    return true
  }

  /**
   * Get field type metadata: `{ fieldName: { type, yjs } }`.
   * Used by ResourceAgent to route edit_text between server-side Yjs editing
   * (for collaborative fields) and Y.Map string replacement (for non-collaborative fields).
   */
  getFieldMeta(): Record<string, { type: string; yjs: boolean }> {
    const form = this._resolveForm()
    const meta: Record<string, { type: string; yjs: boolean }> = {}

    function extract(items: FieldOrGrouping[]) {
      for (const item of items) {
        // Field — has getName, getType, isYjs
        if ('getName' in item && 'getType' in item && 'isYjs' in item) {
          const field = item as Field
          meta[field.getName()] = { type: field.getType(), yjs: field.isYjs() }
        }
        // Section or Tab — has getFields()
        if ('getFields' in item) {
          extract((item as Section).getFields() as unknown as FieldOrGrouping[])
        }
        // Tabs — has getTabs() with nested fields
        if ('getTabs' in item) {
          for (const tab of (item as Tabs).getTabs()) {
            extract(tab.getFields() as unknown as FieldOrGrouping[])
          }
        }
      }
    }
    extract(form.getFields())
    return meta
  }

  // ── Internal resolvers ────────────────────────────────

  /** @internal — Constructs Table with resource wired, calls this.table(). */
  _resolveTable(): Table {
    const Cls = this.constructor as typeof Resource
    const table = Table.make(Cls.getLabel()).fromResource(Cls as { new(): any; getSlug(): string; model?: any })
    return this.table(table)
  }

  /** @internal — Constructs Form, calls this.form(). */
  _resolveForm(): Form {
    const Cls = this.constructor as typeof Resource
    return this.form(Form.make(Cls.getSlug()))
  }

  // ── Static helpers ──────────────────────────────────────

  static getSlug(): string {
    if (this.slug) return this.slug
    const name = this.name.replace(/Resource$/, '')
    const kebab = name
      .replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)
      .replace(/^-/, '')
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
    return label.endsWith('s') ? label.slice(0, -1) : label
  }

  // ── Instance meta ───────────────────────────────────────

  /** @internal */
  toMeta(): ResourceMeta {
    const Cls = this.constructor as typeof Resource

    // Resolve form to get field meta
    const form = this._resolveForm()
    const formFields = form.getFields()
    const fieldsMeta = formFields.map((f) => (f as { toMeta(): unknown }).toMeta()) as SchemaItemMeta[]

    // Resolve table and form for config
    const table = Cls.model ? this._resolveTable() : undefined
    const tableConfig = table?.getConfig()
    const formMeta = form.toMeta()

    const emptyState = tableConfig?.emptyState

    const meta: ResourceMeta = {
      label:         Cls.getLabel(),
      labelSingular: Cls.getLabelSingular(),
      slug:          Cls.getSlug(),
      fields:        fieldsMeta,
      autosave:       !!formMeta.autosave,
      autosaveInterval: formMeta.autosaveInterval ?? 30000,
      live:            tableConfig?.live ?? false,
      versioned:       !!formMeta.versioned,
      draftable:       !!formMeta.draftable,
      softDeletes:     tableConfig?.softDeletes ?? false,
    }

    if (tableConfig?.titleField) meta.titleField     = tableConfig.titleField
    if (emptyState?.icon)        meta.emptyStateIcon        = emptyState.icon
    if (emptyState?.heading)     meta.emptyStateHeading     = emptyState.heading
    if (emptyState?.description) meta.emptyStateDescription = emptyState.description

    const agentDefs = this.agents()
    if (agentDefs.length > 0) {
      meta.agents = agentDefs.map(a => a.toMeta())
    }

    return meta
  }
}
