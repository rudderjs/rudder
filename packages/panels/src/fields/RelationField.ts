import { Field } from '../Field.js'

export class RelationField extends Field {
  protected _resourceName?: string
  protected _displayField  = 'name'
  protected _multiple      = false

  static make(name: string): RelationField {
    return new RelationField(name)
  }

  getType(): string { return this._multiple ? 'hasMany' : 'belongsTo' }

  /** Name of the target Resource class (e.g. 'UserResource'). */
  resource(resourceName: string): this {
    this._resourceName = resourceName
    this._extra['resource'] = resourceName
    return this
  }

  /** Which field to display as the option label in the select (default: 'name'). */
  displayField(field: string): this {
    this._displayField = field
    this._extra['displayField'] = field
    return this
  }

  /** Allow selecting multiple related records (hasMany). */
  multiple(value = true): this {
    this._multiple = value
    this._extra['multiple'] = value
    return this
  }
}
