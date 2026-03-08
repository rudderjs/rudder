import { Field } from '../Field.js'

export class DateField extends Field {
  protected _withTime = false

  static make(name: string): DateField {
    return new DateField(name)
  }

  getType(): string { return this._withTime ? 'datetime' : 'date' }

  /** Include time picker alongside the date picker. */
  withTime(value = true): this {
    this._withTime = value
    this._extra['withTime'] = value
    return this
  }
}
