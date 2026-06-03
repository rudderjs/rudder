import { JsonResource } from '@rudderjs/orm'
// Type-only — keeps Todo.ts's runtime import of this file cycle-free.
import type { Todo } from '../Models/Todo.js'

/**
 * API-resource demo (`/api/todos`): per-endpoint payload shaping — `done` is
 * renamed from `completed`, timestamps are ISO strings, `updatedAt` only
 * appears when it differs from creation.
 */
export class TodoResource extends JsonResource<Todo> {
  toArray() {
    return {
      id:        this.resource.id,
      title:     this.resource.title,
      done:      this.resource.completed,
      createdAt: this.resource.createdAt.toISOString(),
      updatedAt: this.when(
        this.resource.updatedAt.getTime() !== this.resource.createdAt.getTime(),
        this.resource.updatedAt.toISOString(),
      ),
    }
  }
}
