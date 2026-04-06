import { Field } from '../Field.js'
import { FieldType } from '../FieldType.js'

export class JsonField extends Field {
  constructor(name: string) {
    super(name)
    this._extra['rows'] = 6
  }

  static make(name: string): JsonField {
    return new JsonField(name)
  }

  rows(n: number): this {
    this._extra['rows'] = n
    return this
  }

  getType(): string { return FieldType.Json }
}
