import { Field } from '../Field.js'
import { FieldType } from '../FieldType.js'

export class TagsField extends Field {
  static make(name: string): TagsField {
    return new TagsField(name)
  }

  placeholder(text: string): this {
    this._extra['placeholder'] = text
    return this
  }

  getType(): string { return FieldType.Tags }
}
