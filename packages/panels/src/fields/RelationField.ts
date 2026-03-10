import { Field } from '../Field.js'

export class RelationField extends Field {
  protected _resourceSlug?: string
  protected _displayField  = 'name'
  protected _multiple      = false

  static make(name: string): RelationField {
    return new RelationField(name)
  }

  getType(): string { return this._multiple ? 'belongsToMany' : 'belongsTo' }

  /** Slug of the target resource (e.g. 'categories'). */
  resource(resourceSlug: string): this {
    this._resourceSlug = resourceSlug
    this._extra['resource'] = resourceSlug
    return this
  }

  /** Which field to display as the option label in the select (default: 'name'). */
  display(field: string): this {
    this._displayField = field
    this._extra['displayField'] = field
    return this
  }

  /** @deprecated Use display() */
  displayField(field: string): this {
    return this.display(field)
  }

  /** Allow selecting multiple related records (belongsToMany). */
  multiple(value = true): this {
    this._multiple = value
    this._extra['multiple'] = value
    return this
  }
}
