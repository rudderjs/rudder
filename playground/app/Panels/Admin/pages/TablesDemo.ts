import { Page, Heading, Text, Table, Column, SelectFilter, Action } from '@boostkit/panels'
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
      Text.make('Demonstrates all Table features: pagination, search, sort, remember, lazy, scope, fromArray.'),

      // ── Pages pagination + search + remember(url) ──────────
      Heading.make('Paginated Table (pages + URL persist)').level(2),
      Text.make('Search, sort, and pagination state persists in the URL. Try searching, sorting, then sharing the URL.'),

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
        .remember('url')
        .filters([
          SelectFilter.make('draftStatus').label('Status').options([
            { label: 'Published', value: 'published' },
            { label: 'Draft', value: 'draft' },
          ]),
        ])
        .actions([
          Action.make('publish').label('Publish').bulk(),
          Action.make('delete').label('Delete').destructive().confirm('Delete selected articles?').bulk(),
        ]),

      // ── Load More pagination + remember(localStorage) ──────
      Heading.make('Load More Table (localStorage)').level(2),
      Text.make('Click "Load more" to append records. State saved in localStorage.'),

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
      Heading.make('Session Persist Table').level(2),
      Text.make('Page/sort/search state saved in server session. SSR\'d correctly on refresh.'),

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
      Heading.make('Scoped Table').level(2),
      Text.make('Only shows published articles using .scope().'),

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

      // ── Static array ─────────────────────────────────────────
      Heading.make('Static Data Table').level(2),
      Text.make('No model — data provided inline via .fromArray().'),

      Table.make('Browser Market Share')
        .fromArray([
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
      Heading.make('Simple Table (no persist)').level(2),
      Text.make('Basic table with no state persistence. Resets on every page load.'),

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
