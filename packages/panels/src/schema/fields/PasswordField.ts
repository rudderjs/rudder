import { Field } from '../Field.js'

export class PasswordField extends Field {
  constructor(name: string) {
    super(name)
    this._extra['confirm'] = false
    this.hideFromTable()   // passwords never shown in table
  }

  static make(name: string): PasswordField {
    return new PasswordField(name)
  }

  /** Show a "confirm password" input below the main input. */
  confirm(value = true): this {
    this._extra['confirm'] = value
    return this
  }

  getType(): string { return 'password' }
}
