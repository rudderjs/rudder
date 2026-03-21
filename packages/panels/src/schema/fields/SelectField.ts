import { Field } from '../Field.js'

export interface SelectOption {
  label: string
  value: string | number | boolean
}

export class SelectField extends Field {
  protected _options: SelectOption[] = []
  protected _multiple = false

  static make(name: string): SelectField {
    return new SelectField(name)
  }

  getType(): string { return this._multiple ? 'multiselect' : 'select' }

  /** Pass an array of strings, or label/value pairs. */
  options(opts: string[] | SelectOption[]): this {
    this._options = opts.map((o) =>
      typeof o === 'string' ? { label: o, value: o } : o,
    )
    this._extra['options'] = this._options
    return this
  }

  /** @override — also stores in extra for backwards compat. */
  override default(value: unknown | ((ctx: unknown) => unknown)): this {
    super.default(value)
    if (typeof value !== 'function') this._extra['default'] = value
    return this
  }

  multiple(value = true): this {
    this._multiple = value
    this._extra['multiple'] = value
    return this
  }
}
