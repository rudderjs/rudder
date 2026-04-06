import { Field } from '../Field.js'
import { FieldType } from '../FieldType.js'

export class TextField extends Field {
  protected _minLength?: number
  protected _maxLength?: number
  protected _placeholder?: string

  static make(name: string): TextField {
    return new TextField(name)
  }

  getType(): string { return FieldType.Text }

  minLength(n: number): this {
    this._minLength = n
    this._extra['minLength'] = n
    return this
  }

  maxLength(n: number): this {
    this._maxLength = n
    this._extra['maxLength'] = n
    return this
  }

  placeholder(text: string): this {
    this._placeholder = text
    this._extra['placeholder'] = text
    return this
  }
}
