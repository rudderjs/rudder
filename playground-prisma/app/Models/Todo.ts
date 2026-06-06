import { Model } from '@rudderjs/orm'
import { TodoResource } from '../Resources/TodoResource.js'

export class Todo extends Model {
  static table = 'todo'

  // `todo.toResource()` / `toResourceCollection()` resolve through this
  // binding — TodoResource.ts imports Todo type-only, so the runtime import
  // direction stays one-way (no cycle). Demo endpoint: /api/todos.
  static resourceClass = TodoResource

  id!:        string
  title!:     string
  completed!: boolean
  createdAt!: Date
  updatedAt!: Date
}
