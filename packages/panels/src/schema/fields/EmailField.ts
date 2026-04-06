import { Field } from '../Field.js'
import { FieldType } from '../FieldType.js'

export class EmailField extends Field {
  static make(name: string): EmailField {
    return new EmailField(name)
  }

  getType(): string { return FieldType.Email }
}
