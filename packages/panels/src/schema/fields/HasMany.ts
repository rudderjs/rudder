import { Field } from '../Field.js'

/**
 * Renders a table of related records on the show page.
 *
 * @example
 * // Children of the current category
 * HasMany.make('children')
 *   .label('Sub-categories')
 *   .resource('categories')
 *   .foreignKey('parentId')
 *
 * // Articles linked via M2M
 * HasMany.make('articles')
 *   .label('Articles')
 *   .resource('articles')
 *   .throughMany()
 */
export class HasMany extends Field {
  static make(name: string): HasMany {
    const f = new HasMany(name)
    // Always hidden from table / create / edit — only shows on show page
    f._hidden.add('table')
    f._hidden.add('create')
    f._hidden.add('edit')
    return f
  }

  getType(): string { return 'hasMany' }

  /** Slug of the related resource (e.g. 'categories', 'articles'). */
  resource(slug: string): this {
    this._extra['resource'] = slug
    return this
  }

  /** The foreign-key column on the related table that points back to this record's id. */
  foreignKey(key: string): this {
    this._extra['foreignKey'] = key
    return this
  }

  /** Which field to use as the display label in the related table (default: 'name'). */
  displayField(field: string): this {
    this._extra['displayField'] = field
    return this
  }

  /**
   * Mark as a M2M reverse relation (e.g. Article ↔ Category).
   * The related records are fetched via the implicit join table rather than a FK column.
   */
  throughMany(): this {
    this._extra['throughMany'] = true
    return this
  }
}
