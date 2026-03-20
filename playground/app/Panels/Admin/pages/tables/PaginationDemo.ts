import { Page, Heading, Text, Table, Column } from '@boostkit/panels'
import type { PanelContext } from '@boostkit/panels'
import { Article } from '../../../../Models/Article.js'

export class PaginationDemo extends Page {
  static slug  = 'pagination'
  static label = 'Pagination'
  static icon  = 'list'

  static async schema(_ctx: PanelContext) {
    return [
      Heading.make('Pagination Examples'),
      Text.make('Demonstrates pages and loadMore pagination modes.'),

      Heading.make('Pages Mode').level(2),
      Text.make('Numbered page buttons. Click to jump to any page.'),

      Table.make('Articles (Pages)')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title').sortable().searchable(),
          Column.make('createdAt').label('Created').date().sortable(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('pages', 3)
        .searchable()
        .remember('url'),

      Heading.make('Load More Mode').level(2),
      Text.make('Click "Load more" to append records sequentially.'),

      Table.make('Articles (Load More)')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title').sortable(),
          Column.make('createdAt').label('Created').date(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('loadMore', 3)
        .remember('localStorage'),
    ]
  }
}
