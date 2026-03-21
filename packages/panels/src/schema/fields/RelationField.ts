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
  displayField(field: string): this {
    this._displayField = field
    this._extra['displayField'] = field
    return this
  }

  /**
   * Override the Prisma relation name used for eager-loading.
   * By default derived from the field name: `parentId` → `parent`.
   * Use this when the convention doesn't apply.
   *
   * @example
   * RelationField.make('authorId').resource('users').as('author')
   */
  as(relationName: string): this {
    this._extra['relationName'] = relationName
    return this
  }

  /** Allow selecting multiple related records (belongsToMany). */
  multiple(value = true): this {
    this._multiple = value
    this._extra['multiple'] = value
    return this
  }

  /**
   * Allow inline creation of new related records from the relation field.
   * When the user types a value that doesn't match any existing option, a
   * "Create X" entry appears. Selecting it opens a dialog that renders the
   * related resource's full create form.
   */
  creatable(value = true): this {
    this._extra['creatable'] = value
    return this
  }
}
