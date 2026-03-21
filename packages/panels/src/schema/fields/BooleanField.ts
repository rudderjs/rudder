import { Field } from '../Field.js'

export class BooleanField extends Field {
  protected _trueLabel  = 'Yes'
  protected _falseLabel = 'No'

  static make(name: string): BooleanField {
    return new BooleanField(name)
  }

  getType(): string { return 'boolean' }

  trueLabel(label: string): this {
    this._trueLabel = label
    this._extra['trueLabel'] = label
    return this
  }

  falseLabel(label: string): this {
    this._falseLabel = label
    this._extra['falseLabel'] = label
    return this
  }
}
