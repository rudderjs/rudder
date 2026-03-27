import { Page, Heading, List, ViewMode, Column } from '@boostkit/panels'
import { Category } from '../../../Models/Category.js'

export class ListDemoPage extends Page {
  static slug  = 'list-demo'
  static label = 'List Demo'
  static icon  = 'list'

  static schema() {
    return [
      Heading.make('List Demo'),

      // Basic list with title/description fields
      List.make('Categories')
        .fromModel(Category)
        .titleField('name')
        .descriptionField('slug')
        .searchable(['name'])
        .paginated('pages', 5)
        .views([
          'list',
          'grid',
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
