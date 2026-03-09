import { Panel } from '@boostkit/panels'
import { TodoResource } from './resources/TodoResource.js'
import { UserResource } from './resources/UserResource.js'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .branding({
    title: 'BoostKit Admin',
  })
  .layout('sidebar')
  .resources([
    TodoResource,
    UserResource,
  ])