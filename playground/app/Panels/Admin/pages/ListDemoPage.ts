import { Page, Heading, Text, List, ViewMode, Column, DataField, SelectField, SelectFilter } from '@rudderjs/panels'
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

      // ─── 1. Categories — folder + tree + icon + views ──
      Heading.make('Categories — Folder + Tree + Icon').level(2),
      List.make('Categories')
        .id('list-demo-categories')
        .fromModel(Category)
        .titleField('name')
        .descriptionField('slug')
        .iconField('icon')
        .folder('parentId')
        .sortBy('position', 'ASC')
        .searchable(['name'])
        .sortable(['name', 'position'])
        .reorderable('position')
        .paginated('pages', 10)
        .live()
        .views([
          ViewMode.folder([
            DataField.make('name'),
            DataField.make('slug').badge(),
          ]),
          ViewMode.list([
            DataField.make('name').editable(),
            DataField.make('slug').editable('popover'),
          ]),
          ViewMode.grid([
            DataField.make('name').editable(),
            DataField.make('slug').badge(),
          ]),
          ViewMode.tree([
            DataField.make('name'),
            DataField.make('slug').badge(),
          ]),
          ViewMode.table([
            Column.make('name').sortable().editable(),
            Column.make('slug').editable('popover'),
            Column.make('position').numeric().sortable(),
          ]),
        ])
        .defaultView({ sm: 'list', lg: 'list' })
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
        .filters([
          SelectFilter.make('featured').label('Featured').options([
            { label: 'Featured', value: true },
            { label: 'Not featured', value: false },
          ]),
        ])
        .groupBy('status')
        .scopes([
          { label: 'All' },
          { label: 'Published', icon: 'circle-check', scope: (q) => q.where('status', 'published') },
          { label: 'Drafts', icon: 'pencil-line', scope: (q) => q.where('status', 'draft') },
        ])
        .remember('session')
        .live()
        .paginated('pages', 5)
        .views([
          ViewMode.list([
            DataField.make('title'),
            DataField.make('status').badge(),
            DataField.make('createdAt').date(),
          ]),
          ViewMode.table([
            Column.make('title').sortable().editable(),
            Column.make('status').badge().editable(
              SelectField.make('status').options([
                { value: 'draft', label: 'Draft' },
                { value: 'published', label: 'Published' },
              ]),
              'popover'
            ),
            Column.make('featured').boolean().editable(),
            Column.make('createdAt').date().sortable(),
          ]),
        ])
        .remember('session')
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
        .filters([
          SelectFilter.make('role').label('Role').options([
            { label: 'Admin', value: 'admin' },
            { label: 'User', value: 'user' },
          ]),
        ])
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
