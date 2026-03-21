import { Field } from '../Field.js'

export class SlugField extends Field {
  static make(name: string): SlugField {
    return new SlugField(name)
  }

  /**
   * The field name to generate the slug from.
   * @example SlugField.make('slug').from('title')
   */
  from(fieldName: string): this {
    this._extra['from'] = fieldName
    return this
  }

  getType(): string { return 'slug' }
}
