import { Field } from '../Field.js'

export class TextareaField extends Field {
  protected _rows?: number

  static make(name: string): TextareaField {
    return new TextareaField(name)
  }

  getType(): string { return 'textarea' }

  rows(n: number): this {
    this._rows = n
    this._extra['rows'] = n
    return this
  }
}
