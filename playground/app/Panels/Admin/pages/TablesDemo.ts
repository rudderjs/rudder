import { Page, Heading, Text, Table, Column, Section } from '@boostkit/panels'
import type { PanelContext } from '@boostkit/panels'
import { Article } from '../../../Models/Article.js'
import { User }    from '../../../Models/User.js'

export class TablesDemo extends Page {
  static slug  = 'tables-demo'
  static label = 'Tables Demo'
  static icon  = 'table'

  static async schema(_ctx: PanelContext) {
    return [
      Heading.make('Table Examples'),
      Text.make('Demonstrates all Table features: pagination, search, sort, remember, lazy, scope, static rows.'),

      // ── Pages pagination + search + remember(url) ──────────
      Table.make('Articles (URL)')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title').sortable().searchable(),
          Column.make('draftStatus').label('Status').badge().sortable(),
          Column.make('createdAt').label('Created').date().sortable(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('pages', 3)
        .searchable()
        .emptyMessage('No articles found.')
        .remember('url'),


      // ── Load More pagination + remember(localStorage) ──────
      Table.make('Articles (Load More)')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title').sortable().searchable(),
          Column.make('createdAt').label('Created').date(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('loadMore', 3)
        .searchable()
        .remember('localStorage'),


      // ── Session persist ────────────────────────────────────
      Table.make('Users (Session)')
        .fromModel(User)
        .columns([
          Column.make('name').label('Name').sortable().searchable(),
          Column.make('email').label('Email').sortable().searchable(),
          Column.make('role').label('Role').badge(),
          Column.make('createdAt').label('Joined').date(),
        ])
        .paginated('pages', 2)
        .searchable()
        .remember('session'),


      // ── Scoped table ───────────────────────────────────────
      Table.make('Published Articles')
        .fromModel(Article)
        .scope(q => q.where('draftStatus', 'published'))
        .columns([
          Column.make('title').label('Title').sortable(),
          Column.make('createdAt').label('Published').date(),
        ])
        .sortBy('createdAt', 'DESC')
        .limit(5)
        .emptyMessage('No published articles yet.'),

      // ── Static rows ────────────────────────────────────────
      Table.make('Browser Market Share')
        .rows([
          { browser: 'Chrome', share: 65, trend: '+2.1%' },
          { browser: 'Safari', share: 18, trend: '-0.5%' },
          { browser: 'Firefox', share: 10, trend: '-1.2%' },
          { browser: 'Edge', share: 5, trend: '+0.8%' },
          { browser: 'Other', share: 2, trend: '-1.2%' },
        ])
        .columns([
          Column.make('browser').label('Browser').sortable().searchable(),
          Column.make('share').label('Share (%)').numeric().sortable(),
          Column.make('trend').label('Trend'),
        ])
        .searchable()
        .description('Estimated global browser market share'),


      // ── No persistence (default) ───────────────────────────
      Table.make('Recent 5 Articles')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title'),
          Column.make('createdAt').label('Created').date(),
        ])
        .sortBy('createdAt', 'DESC')
        .limit(5),
    ]
  }
}
