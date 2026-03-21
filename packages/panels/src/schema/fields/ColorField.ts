import { Field } from '../Field.js'

export class ColorField extends Field {
  static make(name: string): ColorField {
    return new ColorField(name)
  }

  getType(): string { return 'color' }
}
