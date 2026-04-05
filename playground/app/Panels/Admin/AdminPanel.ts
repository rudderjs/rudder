import { Panel, Heading, Text, Stats, Stat, Chart, List, Table, Column, Tabs, Tab, Dashboard, Widget } from '@rudderjs/panels'
import { panelsLexical } from '@rudderjs/panels-lexical/server'
import { media } from '@rudderjs/media/server'
import { workspaces } from '@rudderjs/workspaces'

import configs from '../../../config/index.js'
import { TodoResource }         from './resources/TodoResource.js'
import { UserResource }         from './resources/UserResource.js'
import { ArticleResource }      from './resources/ArticleResource.js'
import { CategoryResource }     from './resources/CategoryResource.js'
import { SiteSettingsGlobal }   from './globals/SiteSettingsGlobal.js'
import { CustomPage }    from './pages/CustomPage.js'
import { ReportsPage }   from './pages/ReportsPage.js'
import { MediaPage }     from './pages/MediaPage.js'
import { TablesDemo }     from './pages/TablesDemo.js'
import { TabsDemo }       from './pages/TabsDemo.js'
import { FormsDemo }      from './pages/FormsDemo.js'
import { FieldsDemo }        from './pages/FieldsDemo.js'
import { SectionsDemo }      from './pages/SectionsDemo.js'
import { DialogsDemo }       from './pages/DialogsDemo.js'
import { ElementsDemo }     from './pages/ElementsDemo.js'

import { Article }    from 'App/Models/Article.js'
import { Category }   from 'App/Models/Category.js'
import { Todo }       from 'App/Models/Todo.js'
import { User }       from 'App/Models/User.js'
import { SimplePage } from './pages/SimplePage.js'
import { ListDemoPage } from './pages/ListDemoPage.js'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .use(panelsLexical())
  .use(media(configs.media))
  .use(workspaces())
  .branding({
    title: 'RudderJS',
    logo: '/logo.svg',
  })
  .theme({
    preset: 'nova',
    baseColor: 'zinc',
    accentColor: 'orange',
    chartPalette: 'ocean',
    radius: 'none',
    fonts: {
      heading: 'Space Grotesk',
      body: 'Inter',
    },
  })
  .layout('sidebar')
  .locale('en')
  .guard(async (ctx) => ctx.user?.role === 'admin')
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
    Heading.make(`Welcome back${ctx.user?.name ? `, ${ctx.user.name}` : ''}.`),
    Text.make('Here\'s a quick overview of your content.'),

    Stats.make([
      Stat.make('Total Articles').value(await Article.query().count()),
      Stat.make('Total Categories').value(await Category.query().count()),
      Stat.make('Total Todos').value(await Todo.query().count()),
      Stat.make('Total Users').value(await User.query().count()),
    ]),

    Dashboard.make('overview')
      .label('Overview')
      .widgets([
        Widget.make('total-articles')
          .label('Total Articles')
          .small()
          .icon('file-text')
          .schema(async () => [
            Stats.make([
              Stat.make('Total Articles').value(await Article.query().count()).trend(5),
            ]),
          ]),

        Widget.make('total-categories')
          .label('Total Categories')
          .small()
          .icon('folder-open')
          .schema(async () => [
            Stats.make([
              Stat.make('Total Categories').value(await Category.query().count()),
            ]),
          ]),

        Widget.make('total-todos')
          .label('Total Todos')
          .small()
          .icon('check-circle')
          .schema(async () => {
            const completed = await Todo.query().where('completed', true).count()
            const total = await Todo.query().count()
            return [
              Stats.make([
                Stat.make('Completed').value(completed).description(`of ${total} todos`),
              ]),
            ]
          }),

        Widget.make('total-users')
          .label('Total Users')
          .small()
          .icon('users')
          .schema(async () => [
            Stats.make([
              Stat.make('Total Users').value(await User.query().count()),
            ]),
          ]),

        Widget.make('articles-chart')
          .label('Articles per Month')
          .defaultSize({ w: 8, h: 3 })
          .minSize({ w: 4, h: 2 })
          .icon('bar-chart')
          .schema(() => [
            Chart.make('Articles per Month')
              .chartType('bar')
              .labels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
              .datasets([
                { label: 'Published', data: [3, 7, 5, 12, 8, 15] },
                { label: 'Drafts', data: [2, 4, 3, 5, 2, 6] },
              ]),
          ]),

        Widget.make('quick-links')
          .label('Quick Links')
          .defaultSize({ w: 4, h: 3 })
          .icon('link')
          .schema(() => [
            List.make('Quick Links').items([
              { label: 'Documentation', description: 'Read the RudderJS docs', href: '/docs', icon: '📖' },
              { label: 'GitHub', description: 'View source code', href: 'https://github.com/rudderjs/rudder', icon: '🐙' },
              { label: 'Support', description: 'Get help', href: '/contact', icon: '💬' },
            ]),
          ]),
      ]),

    Tabs.make(undefined, [
      Tab.make('Content').schema([
        Table.make('Recent Articles')
          .columns([
            Column.make('title').label('Title'),
            Column.make('createdAt').label('Date'),
          ])
          .fromArray(async () => Article.query().orderBy('createdAt', 'DESC').limit(5).get())
          .href('/admin/articles'),
      ]),
      Tab.make('Charts').schema([
        Chart.make('Weekly Traffic')
          .chartType('area')
          .labels(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
          .datasets([{ label: 'Visitors', data: [120, 230, 180, 350, 290, 150, 90] }]),
      ]),
    ]),
  ])
  .pages([
    TablesDemo,
    TabsDemo,
    FormsDemo,
    FieldsDemo,
    SectionsDemo,
    DialogsDemo,
    ElementsDemo,
    ReportsPage,
    MediaPage,
    CustomPage,
    SimplePage,
    ListDemoPage,
  ])
