import { Page, Heading, Text, Stats, Stat, Chart, List, Tabs, Table, Column, Form, Section, TextField, TextareaField, EmailField, SelectFilter, Action, Dialog } from '@boostkit/panels'
import type { PanelContext } from '@boostkit/panels'
import { Article } from '../../../Models/Article.js'
import { User }    from '../../../Models/User.js'
import { Todo }    from '../../../Models/Todo.js'
import { Category } from '../../../Models/Category.js'

export class ReportsPage extends Page {
  static slug  = 'reports/:id?'
  static label = 'Reports'
  static icon  = 'bar-chart-3'

  static async schema({ params }: PanelContext) {
    return [
      Heading.make('Reports'),
      Heading.make(`number #${params.id}`),
      Text.make('Content and user analytics.'),

      // ── Async Stats with polling ────────────────────────────
      Stats.make('report-stats')
        .data(async () => [
          { label: 'Total Articles', value: await Article.query().count(), trend: 12 },
          { label: 'Total Users', value: await User.query().count() },
          { label: 'Total Todos', value: await Todo.query().count(), description: 'Including completed' },
          { label: 'Categories', value: await Category.query().count() },
        ])
        .poll(60000),

      // ── Static data table ──────────────────────────────────
      Table.make('Browser Stats')
        .rows([
          { browser: 'Chrome', share: 65, trend: 2.1 },
          { browser: 'Safari', share: 18, trend: -0.5 },
          { browser: 'Firefox', share: 10, trend: -1.2 },
          { browser: 'Edge', share: 5, trend: 0.8 },
          { browser: 'Other', share: 2, trend: -1.2 },
        ])
        .columns([
          Column.make('browser').label('Browser').sortable().searchable(),
          Column.make('share').label('Market Share (%)').numeric().sortable(),
          Column.make('trend').label('Trend').numeric(),
        ])
        .description('Estimated browser market share')
        .searchable(),

      // ── Model-backed table with scope, pagination, search ──
      Table.make('Recent Articles')
        .fromModel(Article)
        .scope(q => q.where('draftStatus', 'published'))
        .columns([
          Column.make('title').label('Title').sortable().searchable(),
          Column.make('createdAt').label('Published').date().sortable(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('loadMore', 5)
        .searchable()
        .description('Published articles only')
        .emptyMessage('No published articles yet.'),

      // ── Tabbed content ─────────────────────────────────────
      Tabs.make()
        .tab('Content',
          Chart.make('Articles per Month')
            .chartType('bar')
            .labels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
            .datasets([
              { label: 'Published', data: [3, 7, 5, 12, 8, 15] },
              { label: 'Drafts', data: [2, 4, 3, 5, 2, 6] },
            ]),
        )
        .tab('Users',
          Table.make('All Users')
            .fromModel(User)
            .columns([
              Column.make('name').label('Name').sortable().searchable(),
              Column.make('email').label('Email').sortable(),
              Column.make('createdAt').label('Joined').date(),
            ])
            .paginated('pages', 5)
            .searchable(),
        )
        .tab('Traffic',
          Chart.make('Weekly Visitors')
            .chartType('area')
            .labels(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
            .datasets([{ label: 'Visitors', data: [120, 230, 180, 350, 290, 150, 90] }]),
        )
        .tab('Links',
          List.make('Useful Resources')
            .items([
              { label: 'Google Analytics', href: 'https://analytics.google.com', icon: '📊' },
              { label: 'Search Console', href: 'https://search.google.com/search-console', icon: '🔍' },
            ]),
        ),

      // ── Model-backed tabs ──────────────────────────────────
      Tabs.make('category-tabs')
        .fromModel(Category)
        .title('name')
        .content((record) => [
          Heading.make(record.name).level(2),
          Table.make('Category Articles')
            .fromModel(Article)
            .scope(q => q.where('categoryId', record.id))
            .columns([
              Column.make('title').label('Title').sortable(),
              Column.make('createdAt').label('Date').date(),
            ])
            .limit(5)
            .emptyMessage('No articles in this category.'),
        ]),

      // ── Dialog with Form ───────────────────────────────────
      Dialog.make('feedback-modal')
        .trigger('Send Feedback')
        .title('Report Feedback')
        .description('Help us improve the reports page.')
        .schema([
          Form.make('feedback-form')
            .description('Your feedback is anonymous.')
            .fields([
              TextField.make('subject').label('Subject').required(),
              TextareaField.make('message').label('Message').required(),
            ])
            .submitLabel('Send Feedback')
            .successMessage('Thank you for your feedback!')
            .onSubmit(async (data) => {
              console.log('[feedback]', data)
            }),
        ]),
    ]
  }
}
