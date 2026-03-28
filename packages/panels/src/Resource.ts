import type { Field, FieldMeta } from './schema/Field.js'
import type { Filter } from './schema/Filter.js'
import type { ListTabMeta } from './schema/Tab.js'
import type { Section, SectionMeta } from './schema/Section.js'
import type { Tabs, TabsMeta } from './schema/Tabs.js'
import type { PolicyAction, PanelContext, ModelClass } from './types.js'
import type { PanelColumnMeta } from './schema/Table.js'
import { Table } from './schema/Table.js'
import { Form } from './schema/Form.js'
import { Column } from './schema/Column.js'

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
  columns?:       PanelColumnMeta[]
  filters:        ReturnType<Filter['toMeta']>[]
  tabs:           ListTabMeta[]
  actions:        ReturnType<import('./schema/Action.js').Action['toMeta']>[]
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

  /** Options shown in the per-page dropdown. */
  static perPageOptions = [10, 15, 25, 50, 100]

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

  /** Authorization policy. Return false to deny — API responds 403. */
  async policy(_action: PolicyAction, _ctx: PanelContext): Promise<boolean> {
    return true
  }

  // ── Internal resolvers ────────────────────────────────

  /** @internal — Constructs Table with model wired, calls this.table(). */
  _resolveTable(): Table {
    const Cls = this.constructor as typeof Resource
    const table = Table.make(Cls.getLabel()).fromModel(Cls.model!)
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

    // Derive yjs from form fields
    const hasYjsField = formFields.some((item) => {
      if ('getFields' in item) {
        return (item as { getFields(): Field[] }).getFields().some((f) => f.isYjs())
      }
      return 'isYjs' in item && (item as Field).isYjs()
    })

    // Resolve table and form for config
    const table = Cls.model ? this._resolveTable() : undefined
    const tableConfig = table?.getConfig()
    const formMeta = form.toMeta()

    // Serialize scopes to ListTabMeta format (backward compat with UI tabs)
    let tabsMeta: ListTabMeta[] = []
    if (tableConfig?.scopes && tableConfig.scopes.length > 0) {
      tabsMeta = tableConfig.scopes.map((s) => {
        const meta: ListTabMeta = {
          name:  s.label.toLowerCase().replace(/\s+/g, '-'),
          label: s.label,
        }
        if (s.icon) meta.icon = s.icon
        return meta
      })
    }

    // Serialize Column definitions
    let columnsMeta: PanelColumnMeta[] | undefined
    if (tableConfig?.columns && tableConfig.columns.length > 0 && typeof tableConfig.columns[0] !== 'string') {
      columnsMeta = (tableConfig.columns as Column[]).map((c) => c.toMeta())
    }

    const emptyState = tableConfig?.emptyState

    const meta: ResourceMeta = {
      label:         Cls.getLabel(),
      labelSingular: Cls.getLabelSingular(),
      slug:          Cls.getSlug(),
      icon:          Cls.icon,
      fields:        fieldsMeta,
      ...(columnsMeta ? { columns: columnsMeta } : {}),
      filters:       tableConfig?.filters.map((f) => f.toMeta()) ?? [],
      tabs:          tabsMeta,
      actions:       tableConfig?.actions.map((a) => a.toMeta()) ?? [],
      rememberTable:  !!tableConfig?.remember,
      draftRecovery:  false,
      autosave:       !!formMeta.autosave,
      autosaveInterval: formMeta.autosaveInterval ?? 30000,
      perPage:         tableConfig?.perPage ?? 15,
      perPageOptions:  Cls.perPageOptions,
      paginationType:  tableConfig?.paginationType === 'loadMore' ? 'loadMore' : 'pagination',
      live:            tableConfig?.live ?? false,
      versioned:       !!formMeta.versioned,
      draftable:       !!formMeta.draftable,
      yjs:             hasYjsField,
      softDeletes:     tableConfig?.softDeletes ?? false,
    }

    if (tableConfig?.sortBy)    meta.defaultSort    = tableConfig.sortBy
    if (tableConfig?.sortDir)   meta.defaultSortDir = tableConfig.sortDir
    if (tableConfig?.titleField) meta.titleField     = tableConfig.titleField
    if (Cls.navigationGroup)       meta.navigationGroup       = Cls.navigationGroup
    if (Cls.navigationBadgeColor)  meta.navigationBadgeColor  = Cls.navigationBadgeColor
    if (emptyState?.icon)        meta.emptyStateIcon        = emptyState.icon
    if (emptyState?.heading)     meta.emptyStateHeading     = emptyState.heading
    if (emptyState?.description) meta.emptyStateDescription = emptyState.description

    return meta
  }
}
