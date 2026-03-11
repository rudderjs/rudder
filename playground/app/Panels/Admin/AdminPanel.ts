import { Panel, Heading, Text, Stats, Stat, Table } from '@boostkit/panels'
import { TodoResource }      from './resources/TodoResource.js'
import { UserResource }      from './resources/UserResource.js'
import { ArticleResource }   from './resources/ArticleResource.js'
import { CategoryResource }  from './resources/CategoryResource.js'
import { CustomPage } from './pages/CustomPage.js'
import { Article }    from '../../Models/Article.js'
import { Category }   from '../../Models/Category.js'
import { Todo }       from '../../Models/Todo.js'
import { User }       from '../../Models/User.js'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .branding({
    title: 'BoostKit Admin',
  })
  .layout('sidebar')
  .guard(async (ctx) => ctx.user?.role === 'admin')
  .resources([
    ArticleResource,
    CategoryResource,
    TodoResource,
    UserResource,
  ])
  .pages([
    CustomPage,
  ])
  .schema(async (ctx) => [
    Heading.make(`Welcome back${ctx.user?.name ? `, ${ctx.user.name}` : ''}.`),
    Text.make('Here\'s a quick overview of your content.'),
    Stats.make([
      Stat.make('Articles').value(await Article.query().count()),
      Stat.make('Categories').value(await Category.query().count()),
      Stat.make('Todos').value(await Todo.query().count()),
      Stat.make('Users').value(await User.query().count()),
    ]),
    Table.make('Recent Articles')
      .resource('articles')
      .columns(['title', 'status', 'createdAt'])
      .limit(5),
  ])
