import { Field } from '../Field.js'

export class NumberField extends Field {
  protected _min?: number
  protected _max?: number
  protected _step?: number

  static make(name: string): NumberField {
    return new NumberField(name)
  }

  getType(): string { return 'number' }

  min(n: number): this {
    this._min = n
    this._extra['min'] = n
    return this
  }

  max(n: number): this {
    this._max = n
    this._extra['max'] = n
    return this
  }

  step(n: number): this {
    this._step = n
    this._extra['step'] = n
    return this
  }
}
