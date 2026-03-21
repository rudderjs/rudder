import { Field } from '../Field.js'

export class HiddenField extends Field {
  constructor(name: string) {
    super(name)
    this.hideFromTable()
  }

  static make(name: string): HiddenField {
    return new HiddenField(name)
  }

  /** Static default value sent with every create/edit form. */
  default(value: string | number | boolean): this {
    this._extra['default'] = value
    return this
  }

  getType(): string { return 'hidden' }
}
