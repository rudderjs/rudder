import { Field } from '../Field.js'
import { FieldType } from '../FieldType.js'

export class RepeaterField extends Field {
  constructor(name: string) {
    super(name)
    this._extra['schema']   = []
    this._extra['addLabel'] = 'Add item'
  }

  static make(name: string): RepeaterField {
    return new RepeaterField(name)
  }

  /**
   * Define the fields for each repeater item.
   * @example
   * RepeaterField.make('features').schema([
   *   TextField.make('title').required(),
   *   TextareaField.make('description'),
   * ])
   */
  schema(fields: Field[]): this {
    this._extra['schema'] = fields.map((f) => f.toMeta())
    return this
  }

  /** Label for the "add item" button. Defaults to "Add item". */
  addLabel(label: string): this {
    this._extra['addLabel'] = label
    return this
  }

  /** Maximum number of items allowed. */
  maxItems(n: number): this {
    this._extra['maxItems'] = n
    return this
  }

  getType(): string { return FieldType.Repeater }
}
