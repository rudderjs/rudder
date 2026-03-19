import { Panel, Heading, Text, Stats, Stat, Table, Column, Chart, List, Tab, Tabs, Section, Dashboard, Widget, Form, Dialog, TextField, TextareaField, EmailField } from '@boostkit/panels'
import { TodoResource }         from './resources/TodoResource.js'
import { UserResource }         from './resources/UserResource.js'
import { ArticleResource }      from './resources/ArticleResource.js'
import { CategoryResource }     from './resources/CategoryResource.js'
import { SiteSettingsGlobal }   from './globals/SiteSettingsGlobal.js'
import { CustomPage } from './pages/CustomPage.js'
import { ReportsPage } from './pages/ReportsPage.js'
import { MediaPage } from './pages/MediaPage.js'

import { Article }    from 'App/Models/Article.js'
import { Category }   from 'App/Models/Category.js'
import { Todo }       from 'App/Models/Todo.js'
import { User }       from 'App/Models/User.js'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .branding({
    title: 'BoostKit',
    logo: '/logo.svg',
  })
  .layout('sidebar')
  .locale('en')
  // .guard(async (ctx) => ctx.user?.role === 'admin')
  .resources([
    ArticleResource,
    CategoryResource,
    TodoResource,
    UserResource,
  ])
  .globals([
    SiteSettingsGlobal,
  ])
  .schema(async (ctx) => [
    // ── Static SSR content ───────────────────────────────────
    Heading.make(`Welcome back${ctx.user?.name ? `, ${ctx.user.name}` : ''}.`),
    Text.make('Here\'s a quick overview of your content.'),
    
    // ── Async Stats with auto-refresh ──────────────────────
    Stats.make('overview-stats')
      .data(async () => [
        { label: 'Total Articles', value: await Article.query().count(), trend: 5 },
        { label: 'Total Categories', value: await Category.query().count() },
        { label: 'Total Todos', value: await Todo.query().count(), description: 'Including completed' },
        { label: 'Total Users', value: await User.query().count() },
      ])
      .poll(60000),

    // ── Schema-level Section (collapsible card) ─────────────
    Section.make('Analytics')
      .description('Traffic and content metrics')
      .collapsible()
      .schema(
        Chart.make('Content Growth')
          .chartType('line')
          .labels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
          .datasets([
            { label: 'Articles', data: [5, 12, 18, 25, 33, 42] },
            { label: 'Users', data: [2, 4, 6, 8, 12, 15] },
          ]),
      ),

    // ── Schema-level Tabs ──────────────────────────────────
    Tabs.make('content-tabs', [
      Tab.make('Recent Content')
        .icon('file-text')
        .schema([
          Table.make('Recent Articles')
            .fromModel(Article)
            .columns([
              Column.make('title').label('Title').sortable().searchable(),
              Column.make('createdAt').label('Published').date(),
            ])
            .sortBy('createdAt', 'DESC')
            .paginated('loadMore', 5)
            .searchable()
            .emptyMessage('No articles yet.'),
        ]),
      Tab.make('Charts')
        .icon('bar-chart')
        .schema([
          Chart.make('Weekly Traffic')
            .chartType('area')
            .labels(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
            .datasets([{ label: 'Visitors', data: [120, 230, 180, 350, 290, 150, 90] }]),
        ]),
      Tab.make('Users Table')
        .icon('users')
        .schema([
          Table.make('All Users')
            .fromModel(User)
            .columns([
              Column.make('name').label('Name').sortable().searchable(),
              Column.make('email').label('Email').sortable().searchable(),
              Column.make('createdAt').label('Joined').date(),
            ])
            .sortBy('createdAt', 'DESC')
            .paginated('pages', 5)
            .searchable(),
        ]),
      Tab.make('Links')
        .icon('link')
        .schema([
          List.make('Resources')
            .items([
              { label: 'Documentation', description: 'Read the BoostKit docs', href: '/docs', icon: '📖' },
              { label: 'GitHub', description: 'View source code', href: 'https://github.com/boostkitjs/boostkit', icon: '🐙' },
            ]),
        ]),
    ]),

    // ── Dialog wrapping a Form ───────────────────────────────
    Dialog.make('contact-modal')
      .trigger('Contact Support')
      .title('Send a Message')
      .description('We\'ll get back to you within 24 hours.')
      .schema([
        Form.make('contact-modal-form')
          .description('We typically respond within one business day.')
          .fields([
            TextField.make('name').label('Your Name').required(),
            EmailField.make('email').label('Email Address').required(),
            TextareaField.make('message').label('Message').required(),
          ])
          .submitLabel('Send Message')
          .successMessage('Message sent!')
          .onSubmit(async (data) => {
            console.log('[contact modal form]', data)
          }),
      ]),

    // ── User-customizable dashboard (drag/resize/settings) ───
    Dashboard.make('overview')
      .label('Overview')
      .widgets([
        Widget.make('total-articles')
          .label('Total Articles')
          .component('stat')
          .small()
          // .lazy()
          .icon('file-text')
          .data(async () => ({
            value: await Article.query().count(),
            trend: 5,
          })),

        Widget.make('total-categories')
          .label('Total Categories')
          .component('stat')
          .small()
          .icon('folder-open')
          .data(async () => ({
            value: await Category.query().count(),
          })),

        Widget.make('total-todos')
          .label('Total Todos')
          .component('stat-progress')
          .small()
          .icon('check-circle')
          .data(async () => ({
            value: await Todo.query().where('completed', true).count(),
            max: await Todo.query().count(),
            label: 'Completed',
          })),

        Widget.make('total-users')
          .label('Total Users')
          .component('stat')
          .small()
          .icon('users')
          // .lazy()
          .data(async () => ({
            value: await User.query().count(),
          })),

        Widget.make('articles-chart')
          .label('Articles per Month')
          .component('chart')
          .defaultSize({ w: 8, h: 3 })
          .minSize({ w: 4, h: 2 })
          .icon('📊')
          .settings([
            { name: 'period', type: 'select', label: 'Period', options: ['3 months', '6 months', '12 months'], default: '6 months' },
          ])
          .data(async () => ({
            type: 'bar',
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            datasets: [
              { label: 'Published', data: [3, 7, 5, 12, 8, 15] },
              { label: 'Drafts', data: [2, 4, 3, 5, 2, 6] },
            ],
          })),

        Widget.make('quick-links')
          .label('Quick Links')
          .component('list')
          .defaultSize({ w: 4, h: 3 })
          .icon('🔗')
          .data(async () => ({
            items: [
              { label: 'Documentation', description: 'Read the BoostKit docs', href: '/docs', icon: '📖' },
              { label: 'GitHub', description: 'View source code', href: 'https://github.com/boostkitjs/boostkit', icon: '🐙' },
              { label: 'Support', description: 'Get help', href: '/contact', icon: '💬' },
            ],
          })),
      ])
      .tabs([
        Dashboard.tab('content').label('Content').widgets([
          Widget.make('recent-articles')
            .label('Recent Articles')
            .component('table')
            .large()
            .data(async () => ({
              columns: [
                { name: 'title', label: 'Title' },
                { name: 'createdAt', label: 'Date' },
              ],
              records: await Article.query().orderBy('createdAt', 'DESC').limit(5).get(),
              href: '/admin/articles',
            })),
        ]),
        Dashboard.tab('charts').label('Charts').widgets([
          Widget.make('traffic-chart')
            .label('Weekly Traffic')
            .component('chart')
            .defaultSize({ w: 12, h: 3 })
            .data(async () => ({
              type: 'area',
              labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
              datasets: [{ label: 'Visitors', data: [120, 230, 180, 350, 290, 150, 90] }],
            })),
        ]),
      ]),
  ])
  .pages([
    MediaPage,
    CustomPage,
    ReportsPage,
  ])