import { Panel, Heading, Text, Stats, Stat, Table, Chart, List } from '@boostkit/panels'
import { Dashboard, Widget } from '@boostkit/dashboards'
import { TodoResource }         from './resources/TodoResource.js'
import { UserResource }         from './resources/UserResource.js'
import { ArticleResource }      from './resources/ArticleResource.js'
import { CategoryResource }     from './resources/CategoryResource.js'
import { SiteSettingsGlobal }   from './globals/SiteSettingsGlobal.js'
import { CustomPage } from './pages/CustomPage.js'
import { Article }    from '../../Models/Article.js'
import { Category }   from '../../Models/Category.js'
import { Todo }       from '../../Models/Todo.js'
import { User }       from '../../Models/User.js'

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

    // ── User-customizable dashboard (drag/resize/settings) ───
    Dashboard.make('overview')
      .label('Overview')
      .widgets([
        Widget.make('total-articles')
          .label('Total Articles')
          .component('stat')
          .small()
          .icon('📝')
          .data(async () => ({
            value: await Article.query().count(),
            trend: 5,
          })),

        Widget.make('total-categories')
          .label('Total Categories')
          .component('stat')
          .small()
          .icon('📂')
          .data(async () => ({
            value: await Category.query().count(),
          })),

        Widget.make('total-todos')
          .label('Total Todos')
          .component('stat-progress')
          .small()
          .icon('✅')
          .data(async () => ({
            value: await Todo.query().where('completed', true).count(),
            max: await Todo.query().count(),
            label: 'Completed',
          })),

        Widget.make('total-users')
          .label('Total Users')
          .component('stat')
          .small()
          .icon('👥')
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
              records: await Article.query().orderBy('createdAt', 'desc').limit(5).get(),
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
    CustomPage,
  ])