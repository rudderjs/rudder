import { Field } from '../Field.js'
import { FieldType } from '../FieldType.js'

export class ToggleField extends Field {
  constructor(name: string) {
    super(name)
    this._extra['onLabel']  = 'On'
    this._extra['offLabel'] = 'Off'
  }

  static make(name: string): ToggleField {
    return new ToggleField(name)
  }

  onLabel(label: string): this  { this._extra['onLabel']  = label; return this }
  offLabel(label: string): this { this._extra['offLabel'] = label; return this }

  getType(): string { return FieldType.Toggle }
}
