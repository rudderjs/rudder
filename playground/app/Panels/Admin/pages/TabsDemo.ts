import { Page, Heading, Text, Tab, Tabs, Table, Column, Chart, List, Stats, Stat, Section } from '@boostkit/panels'
import type { PanelContext } from '@boostkit/panels'
import { Article } from '../../../Models/Article.js'
import { User }    from '../../../Models/User.js'
import { Category } from '../../../Models/Category.js'

export class TabsDemo extends Page {
  static slug  = 'tabs-demo'
  static label = 'Tabs Demo'
  static icon  = 'layout-list'

  static async schema(_ctx: PanelContext) {
    return [
      Heading.make('Tabs Examples'),
      Text.make('Demonstrates all Tabs features: persist modes, Tab class, model-backed, lazy, badges, icons.'),

      // ── URL persist ────────────────────────────────────────
      Tabs.make('url-tabs', [
        Tab.make('Articles')
          .icon('file-text')
          .badge(async () => await Article.query().count())
          .schema([
            Table.make('All Articles')
              .fromModel(Article)
              .columns([
                Column.make('title').label('Title').sortable().searchable(),
                Column.make('createdAt').label('Created').date(),
              ])
              .sortBy('createdAt', 'DESC')
              .paginated('pages', 3)
              .searchable(),
          ]),
        Tab.make('Users')
          .icon('users')
          .badge(async () => await User.query().count())
          .schema([
            Table.make('All Users')
              .fromModel(User)
              .columns([
                Column.make('name').label('Name').sortable(),
                Column.make('email').label('Email').sortable(),
              ])
              .paginated('pages', 5),
          ]),
        Tab.make('Charts')
          .icon('bar-chart')
          .schema([
            Chart.make('Monthly Traffic')
              .chartType('area')
              .labels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
              .datasets([{ label: 'Visitors', data: [120, 230, 180, 350, 290, 150, 90] }]),
          ]),
      ]).persist('url'),

      // ── Session persist ────────────────────────────────────
      Tabs.make('session-tabs', [
        Tab.make('Overview')
          .icon('home')
          .schema([
            Stats.make([
              Stat.make('Articles').value(await Article.query().count()),
              Stat.make('Users').value(await User.query().count()),
              Stat.make('Categories').value(await Category.query().count()),
            ]),
          ]),
        Tab.make('Links')
          .icon('link')
          .schema([
            List.make('Resources')
              .items([
                { label: 'Documentation', href: '/docs', icon: '📖' },
                { label: 'GitHub', href: 'https://github.com/boostkitjs/boostkit', icon: '🐙' },
              ]),
          ]),
      ]).persist('session'),

      // ── localStorage persist ───────────────────────────────
      Tabs.make('local-tabs', [
        Tab.make('Tab A').schema([Text.make('Content of Tab A — persisted in localStorage.')]),
        Tab.make('Tab B').schema([Text.make('Content of Tab B.')]),
        Tab.make('Tab C').schema([Text.make('Content of Tab C.')]),
      ]).persist('localStorage'),

      // ── No persist (default) ───────────────────────────────
      Tabs.make('no-persist-tabs', [
        Tab.make('First').schema([Text.make('This is always the default tab.')]),
        Tab.make('Second').schema([Text.make('Switch here — refresh goes back to First.')]),
      ]),

      // ── Lazy tab ───────────────────────────────────────────
      Tabs.make('lazy-tabs', [
        Tab.make('Light Content')
          .schema([
            Text.make('This tab is SSR\'d normally.'),
            Stats.make([Stat.make('Fast').value('instant')]),
          ]),
        Tab.make('Heavy Data')
          .lazy()
          .icon('database')
          .schema([
            Table.make('All Articles (Lazy)')
              .fromModel(Article)
              .columns([
                Column.make('title').label('Title'),
                Column.make('createdAt').label('Created').date(),
              ])
              .limit(5),
          ]),
      ]),

      // ── Model-backed tabs ──────────────────────────────────
      Tabs.make('category-tabs')
        .fromModel(Category)
        .title('name')
        .content((record) => [
          Heading.make(record.name).level(2),
          Text.make(`Category ID: ${record.id}`),
          Table.make('Articles in Category')
            .fromModel(Article)
            .scope(q => q.where('categoryId', record.id))
            .columns([
              Column.make('title').label('Title'),
              Column.make('createdAt').label('Created').date(),
            ])
            .limit(5)
            .emptyMessage('No articles in this category.'),
        ]),

      // ── Shorthand .tab() ───────────────────────────────────
      Tabs.make()
        .tab('Inline A', Text.make('Content defined inline with .tab()'))
        .tab('Inline B', Text.make('Second tab, also inline.')),

    ]
  }
}
