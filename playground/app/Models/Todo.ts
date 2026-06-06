import { Model } from '@rudderjs/orm'
import { TodoResource } from '../Resources/TodoResource.js'

export class Todo extends Model.for<'todos'>() {
  static table = 'todos'

  // Casts refine BOTH runtime values and the generated registry types: sqlite
  // stores booleans as INTEGER and datetimes as TEXT; with these casts the
  // generator emits `completed: boolean` / `createdAt: Date` instead.
  static casts = {
    completed: 'boolean',
    createdAt: 'date',
    updatedAt: 'date',
  } as const

  // `todo.toResource()` / `toResourceCollection()` resolve through this
  // binding — TodoResource.ts imports Todo type-only, so the runtime import
  // direction stays one-way (no cycle). Demo endpoint: /api/todos.
  static resourceClass = TodoResource
}
