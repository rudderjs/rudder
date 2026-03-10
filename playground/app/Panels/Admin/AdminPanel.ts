import { Panel } from '@boostkit/panels'
import { TodoResource }      from './resources/TodoResource.js'
import { UserResource }      from './resources/UserResource.js'
import { ArticleResource }   from './resources/ArticleResource.js'
import { CategoryResource }  from './resources/CategoryResource.js'
import { CustomPage } from './pages/CustomPage.js'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .branding({
    title: 'BoostKit Admin',
  })
  .layout('sidebar')
  .resources([
    ArticleResource,
    CategoryResource,
    TodoResource,
    UserResource,
  ])
  .pages([
    CustomPage,
  ])
