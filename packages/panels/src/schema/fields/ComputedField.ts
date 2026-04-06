import { Field } from '../Field.js'
import { FieldType } from '../FieldType.js'

/**
 * ComputedField — a virtual column with no database backing.
 *
 * The value is derived from the full record object on the server per request,
 * then sent to the frontend alongside real DB fields.
 *
 * Always readonly. Hidden from create and edit forms.
 * Chain `.display(fn)` to further format the computed value before sending.
 *
 * Inspired by FilamentPHP's `->state(fn)` and PayloadCMS's `hooks.afterRead`.
 *
 * @example
 * ComputedField.make('fullName')
 *   .compute((r) => `${(r as User).firstName} ${(r as User).lastName}`)
 *
 * ComputedField.make('wordCount')
 *   .compute((r) => (r as Article).body?.split(/\s+/).length ?? 0)
 *   .display((v) => `${v} words`)
 */
export class ComputedField extends Field {
  private _computeFn: (record: unknown) => unknown = () => null

  static make(name: string): ComputedField {
    return new ComputedField(name)
  }

  constructor(name: string) {
    super(name)
    this._readonly = true
    this._hidden.add('create')
    this._hidden.add('edit')
  }

  /**
   * Derive the field value from the full record object.
   * Runs server-side per record in list and show responses.
   */
  compute(fn: (record: unknown) => unknown): this {
    this._computeFn = fn
    return this
  }

  /** @internal — called by PanelServiceProvider.applyTransforms() */
  apply(record: unknown): unknown {
    return this._computeFn(record)
  }

  getType(): string { return FieldType.Computed }
}
