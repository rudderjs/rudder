import type { Field } from './Field.js'
import type { FieldMeta } from './Field.js'

// ─── Tabs meta (for UI / meta endpoint) ────────────────────

export interface TabMeta {
  label:  string
  fields: FieldMeta[]
}

export interface TabsMeta {
  type: 'tabs'
  tabs: TabMeta[]
}

// ─── Tab ───────────────────────────────────────────────────

class Tab {
  constructor(
    private _label:  string,
    private _fields: Field[] = [],
  ) {}

  getLabel():  string  { return this._label }
  getFields(): Field[] { return this._fields }

  toMeta(): TabMeta {
    return {
      label:  this._label,
      fields: this._fields.map((f) => f.toMeta()),
    }
  }
}

// ─── Tabs class ────────────────────────────────────────────

export class Tabs {
  private _tabs: Tab[] = []

  static make(): Tabs { return new Tabs() }

  /** Add a tab with the given label and fields. */
  tab(label: string, ...fields: Field[]): this {
    this._tabs.push(new Tab(label, fields))
    return this
  }

  /** @internal — flat field list for validation / query building */
  getFields(): Field[] { return this._tabs.flatMap((t) => t.getFields()) }

  /** @internal — serialized for the meta endpoint */
  toMeta(): TabsMeta {
    return {
      type: 'tabs',
      tabs:  this._tabs.map((t) => t.toMeta()),
    }
  }
}
