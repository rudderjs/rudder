import type { Field } from './Field.js'
import type { FieldMeta } from './Field.js'

// ─── Generic item — any object (fields, schema elements, widgets) ──────
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface MetaItem {}

// ─── Tabs meta (for UI / meta endpoint) ────────────────────

export interface TabMeta {
  label:    string
  fields:   FieldMeta[]
  /** Schema elements (used in Panel.schema() tabs). Undefined when used with fields. */
  elements?: unknown[]
}

export interface TabsMeta {
  type: 'tabs'
  id?:  string | undefined
  tabs: TabMeta[]
}

// ─── Tab ───────────────────────────────────────────────────

class Tab {
  constructor(
    private _label: string,
    private _items: MetaItem[] = [],
  ) {}

  getLabel():  string      { return this._label }

  /** Get items as Field[] (for resource field context). */
  getFields(): Field[] {
    return this._items.filter(
      (item): item is Field => typeof (item as Record<string, unknown>)['getType'] === 'function' && typeof (item as Record<string, unknown>)['getName'] === 'function'
    )
  }

  /** Get all raw items. */
  getItems(): MetaItem[] { return this._items }

  /** Check if this tab contains fields (resource context) or schema elements (panel context). */
  hasFields(): boolean { return this._items.length > 0 && this.getFields().length === this._items.length }

  toMeta(): TabMeta {
    // Field context — all items are fields with toMeta()
    if (this.hasFields()) {
      return {
        label:  this._label,
        fields: this.getFields().map((f) => f.toMeta()),
      }
    }

    // Schema element context — return label only, elements resolved by resolveSchema
    return {
      label: this._label,
      fields: [],
      elements: [], // placeholder — resolveSchema fills this in
    }
  }
}

// ─── Tabs class ────────────────────────────────────────────

export class Tabs {
  private _tabs: Tab[] = []
  private _id?: string

  static make(id?: string): Tabs {
    const tabs = new Tabs()
    if (id !== undefined) tabs._id = id
    return tabs
  }

  getId(): string | undefined { return this._id }

  /**
   * Add a tab with the given label and items.
   * Items can be Field instances (resource forms) or schema elements (panel landing page).
   *
   * @example
   * // Resource fields
   * Tabs.make()
   *   .tab('Content', TextField.make('title'), TextareaField.make('body'))
   *   .tab('SEO', TextField.make('metaTitle'))
   *
   * // Panel schema elements
   * Tabs.make()
   *   .tab('Overview', Stats.make([...]), Chart.make('Revenue')...)
   *   .tab('Activity', Table.make('Recent')..., List.make('Links')...)
   */
  tab(label: string, ...items: MetaItem[]): this {
    this._tabs.push(new Tab(label, items))
    return this
  }

  /** @internal — flat field list for validation / query building (resource context). */
  getFields(): Field[] { return this._tabs.flatMap((t) => t.getFields()) }

  /** @internal — get raw tabs. */
  getTabs(): Tab[] { return this._tabs }

  getType(): 'tabs' { return 'tabs' }

  /** @internal — serialized for the meta endpoint */
  toMeta(): TabsMeta {
    return {
      type: 'tabs',
      ...(this._id !== undefined && { id: this._id }),
      tabs:  this._tabs.map((t) => t.toMeta()),
    }
  }
}
