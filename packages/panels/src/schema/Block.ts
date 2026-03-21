import type { Field } from './Field.js'
import type { FieldMeta } from './Field.js'

// ─── Block meta ────────────────────────────────────────────

export interface BlockMeta {
  name:   string
  label:  string
  icon:   string | undefined
  schema: FieldMeta[]
}

// ─── Block builder ─────────────────────────────────────────

export class Block {
  private _name:   string
  private _label?: string
  private _icon?:  string
  private _schema: Field[] = []

  protected constructor(name: string) {
    this._name = name
  }

  static make(name: string): Block {
    return new Block(name)
  }

  /** Display label shown in the block picker. Defaults to the block name. */
  label(label: string): this {
    this._label = label
    return this
  }

  /** Emoji or icon string shown in the block picker. */
  icon(icon: string): this {
    this._icon = icon
    return this
  }

  /** Fields that appear when this block type is added. */
  schema(fields: Field[]): this {
    this._schema = fields
    return this
  }

  /** @internal */
  toMeta(): BlockMeta {
    return {
      name:   this._name,
      label:  this._label ?? this._name,
      icon:   this._icon,
      schema: this._schema.map((f) => f.toMeta()),
    }
  }
}
