import { Page, Heading, List, ViewMode, Column, DataField } from '@boostkit/panels'
import { Category } from '../../../Models/Category.js'

export class ListDemoPage extends Page {
  static slug  = 'list-demo'
  static label = 'List Demo'
  static icon  = 'list'

  static schema() {
    return [
      Heading.make('List Demo'),

      List.make('Categories')
        .id('list-demo-categories')
        .fromModel(Category)
        .titleField('name')
        .descriptionField('slug')
        .sortBy('name', 'ASC')
        .searchable(['name'])
        .paginated('pages', 5)
        .views([
          // List view with DataField definitions
          ViewMode.list([
            DataField.make('name'),
            DataField.make('slug'),
          ]),
          // Grid view with DataField
          ViewMode.grid([
            DataField.make('name'),
            DataField.make('slug').badge(),
          ]),
          // Table view with Column (extends DataField + sortable/searchable)
          ViewMode.table([
            Column.make('name').sortable(),
            Column.make('slug'),
          ]),
        ])
        .defaultView({ sm: 'list', lg: 'grid' })
        .remember('session')
        .exportable(),
    ]
  }
}
