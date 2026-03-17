import { Panel, Heading, Text, Stats, Stat, Table, Chart, List, Tabs, Section, Dashboard, Widget } from '@boostkit/panels'
import { TodoResource }         from './resources/TodoResource.js'
import { UserResource }         from './resources/UserResource.js'
import { ArticleResource }      from './resources/ArticleResource.js'
import { CategoryResource }     from './resources/CategoryResource.js'
import { SiteSettingsGlobal }   from './globals/SiteSettingsGlobal.js'
import { CustomPage } from './pages/CustomPage.js'
import { ReportsPage } from './pages/ReportsPage.js'
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
    
    Stats.make([
      Stat.make('Total Articles').value(await Article.query().count()),
      Stat.make('Total Categories').value(await Category.query().count()),
      Stat.make('Total Todos').value(await Todo.query().count()),
      Stat.make('Total Users').value(await User.query().count()),
    ]),

    // ── Standalone widgets (ssr, static, no customization) ──────────
    Widget.make('articles-overview')
      .label('Published Articles')
      .component('stat')
      .defaultSize({ w: 3, h: 1 })
      .icon('newspaper')
      .lazy()
      .data(async () => ({
        value: await Article.query().count(),
        trend: 8,
        description: 'Total published articles',
      })),

    Widget.make('todo-progress')
      .label('Todo Progress')
      .component('stat-progress')
      .defaultSize({ w: 4, h: 1 })
      .icon('list-checks')
      .data(async () => ({
        value: await Todo.query().where('completed', true).count(),
        max: await Todo.query().count(),
        label: 'Tasks completed',
      })),

    Widget.make('total-users-static')
      .label('Total Users')
      .component('stat')
      .defaultSize({ w: 4, h: 2 })
      .icon('users')
      .data(async () => ({
        value: await User.query().count(),
      })),

    // ── Schema-level Tabs ──────────────────────────────────────
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
    Tabs.make()
      .tab('Recent Content',
        Table.make('Recent Articles')
          .resource('articles')
          .columns(['title', 'createdAt'])
          .limit(5),
      )
      .tab('Charts',
        Chart.make('Weekly Traffic')
          .chartType('area')
          .labels(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
          .datasets([{ label: 'Visitors', data: [120, 230, 180, 350, 290, 150, 90] }]),
      )
      .tab('Links',
        List.make('Resources')
          .items([
            { label: 'Documentation', description: 'Read the BoostKit docs', href: '/docs', icon: '📖' },
            { label: 'GitHub', description: 'View source code', href: 'https://github.com/boostkitjs/boostkit', icon: '🐙' },
          ]),
      ),

    // ── User-customizable dashboard (drag/resize/settings) ───
    Dashboard.make('overview')
      .label('Overview')
      .widgets([
        Widget.make('total-articles')
          .label('Total Articles')
          .component('stat')
          .small()
          .lazy()
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
          .lazy()
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
    CustomPage,
    ReportsPage,
  ])