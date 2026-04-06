import { Field } from '../Field.js'
import { FieldType } from '../FieldType.js'

export class DateField extends Field {
  protected _withTime = false

  static make(name: string): DateField {
    return new DateField(name)
  }

  getType(): string { return this._withTime ? FieldType.DateTime : FieldType.Date }

  /** Include time picker alongside the date picker. */
  withTime(value = true): this {
    this._withTime = value
    this._extra['withTime'] = value
    return this
  }
}
