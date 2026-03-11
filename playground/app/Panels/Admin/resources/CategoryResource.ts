import { Resource, TextField, SlugField, RelationField, HasMany } from '@boostkit/panels'
import { Category } from '../../../Models/Category.js'

export class CategoryResource extends Resource {
  static model         = Category
  static slug          = 'categories'
  static label         = 'Categories'
  static labelSingular = 'Category'
  static titleField    = 'name'
  static defaultSort   = 'name'

  fields() {
    return [
      TextField.make('name')
        .label('Name')
        .required()
        .searchable()
        .sortable(),

      SlugField.make('slug')
        .label('Slug')
        .from('name')
        .required(),

      RelationField.make('parentId')
        .label('Parent Category')
        .resource('categories')
        .displayField('name'),

      HasMany.make('children')
        .label('Sub-categories')
        .resource('categories')
        .foreignKey('parentId'),

      HasMany.make('articles')
        .label('Articles')
        .resource('articles')
        .foreignKey('categories')
        .throughMany(),
    ]
  }
}
