import { Page, Heading, Text, List, ViewMode, Column, DataField } from '@boostkit/panels'
import { Category } from '../../../Models/Category.js'
import { Article } from '../../../Models/Article.js'
import { Todo } from '../../../Models/Todo.js'
import { User } from '../../../Models/User.js'

export class ListDemoPage extends Page {
  static slug  = 'list-demo'
  static label = 'List Demo'
  static icon  = 'list'

  static schema() {
    return [
      Heading.make('List Demo'),
      Text.make('Showcases the List element with views, search, sort, scopes, groupBy, pagination, and export.'),

      // ─── 1. Categories — views + search + pagination + export ──
      Heading.make('Categories — Views + Search + Export').level(2),
      List.make('Categories')
        .id('list-demo-categories')
        .fromModel(Category)
        .titleField('name')
        .descriptionField('slug')
        .sortBy('name', 'ASC')
        .searchable(['name'])
        .sortable(['name', 'slug'])
        .paginated('pages', 5)
        .views([
          ViewMode.list([
            DataField.make('name'),
            DataField.make('slug'),
          ]),
          ViewMode.grid([
            DataField.make('name'),
            DataField.make('slug').badge(),
          ]),
          ViewMode.table([
            Column.make('name').sortable(),
            Column.make('slug'),
          ]),
        ])
        .defaultView({ sm: 'list', lg: 'grid' })
        .remember('session')
        .exportable(['csv', 'json']),

      // ─── 2. Articles — scopes + groupBy + onRecordClick ────────
      Heading.make('Articles — Scopes + GroupBy').level(2),
      List.make('Articles')
        .id('list-demo-articles')
        .fromModel(Article)
        .titleField('title')
        .descriptionField('excerpt')
        .sortBy('createdAt', 'DESC')
        .searchable(['title'])
        .groupBy('status')
        .scopes([
          { label: 'All' },
          { label: 'Published', icon: 'circle-check', scope: (q) => q.where('status', 'published') },
          { label: 'Drafts', icon: 'pencil-line', scope: (q) => q.where('status', 'draft') },
        ])
        .paginated('pages', 5)
        .views([
          ViewMode.list([
            DataField.make('title'),
            DataField.make('status').badge(),
            DataField.make('createdAt').date(),
          ]),
          ViewMode.table([
            Column.make('title').sortable(),
            Column.make('status').badge(),
            Column.make('featured').boolean(),
            Column.make('createdAt').date().sortable(),
          ]),
        ])
        .onRecordClick('edit'),

      // ─── 3. Todos — computed field + display transform ─────────
      Heading.make('Todos — Computed + Display').level(2),
      List.make('Todos')
        .id('list-demo-todos')
        .fromModel(Todo)
        .titleField('title')
        .sortBy('createdAt', 'DESC')
        .searchable(['title'])
        .sortable([
          'title',
          { field: 'createdAt', label: 'Date Created' },
        ])
        .paginated('loadMore', 5)
        .views([
          ViewMode.list([
            DataField.make('title'),
            DataField.make('completed').boolean(),
            DataField.make('createdAt').date(),
          ]),
          ViewMode.grid([
            DataField.make('title'),
            DataField.make('completed').badge(),
          ]),
        ])
        .defaultView({ sm: 'list', lg: 'list' }),

      // ─── 4. Users — simple list with custom labels ─────────────
      Heading.make('Users — Sortable with Custom Labels').level(2),
      List.make('Users')
        .id('list-demo-users')
        .fromModel(User)
        .titleField('name')
        .descriptionField('email')
        .sortBy('name', 'ASC')
        .searchable(['name', 'email'])
        .sortable([
          { field: 'name', label: 'Name' },
          { field: 'email', label: 'Email' },
          { field: 'role', label: 'Role' },
          { field: 'createdAt', label: 'Joined' },
        ])
        .views([
          ViewMode.list([
            DataField.make('name'),
            DataField.make('email'),
            DataField.make('role').badge(),
          ]),
          ViewMode.table([
            Column.make('name').sortable(),
            Column.make('email'),
            Column.make('role').badge(),
            Column.make('createdAt').date().sortable(),
          ]).label('Detailed'),
        ]),

      // ─── 5. Static data — fromArray ────────────────────────────
      Heading.make('Static Data — fromArray').level(2),
      List.make('Browsers')
        .id('list-demo-browsers')
        .fromArray([
          { id: '1', name: 'Chrome',  share: 65, type: 'Chromium' },
          { id: '2', name: 'Safari',  share: 19, type: 'WebKit' },
          { id: '3', name: 'Firefox', share: 4,  type: 'Gecko' },
          { id: '4', name: 'Edge',    share: 5,  type: 'Chromium' },
          { id: '5', name: 'Opera',   share: 3,  type: 'Chromium' },
          { id: '6', name: 'Brave',   share: 2,  type: 'Chromium' },
          { id: '7', name: 'Vivaldi', share: 1,  type: 'Chromium' },
          { id: '8', name: 'Arc',     share: 1,  type: 'Chromium' },
        ])
        .titleField('name')
        .descriptionField('type')
        .searchable(['name'])
        .groupBy('type')
        .views([
          ViewMode.list([
            DataField.make('name'),
            DataField.make('share').numeric(),
            DataField.make('type').badge(),
          ]),
          ViewMode.table([
            Column.make('name'),
            Column.make('share').numeric(),
            Column.make('type').badge(),
          ]),
        ]),
    ]
  }
}
