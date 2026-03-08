import { Field } from '../Field.js'

export class EmailField extends Field {
  static make(name: string): EmailField {
    return new EmailField(name)
  }

  getType(): string { return 'email' }
}
