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
    // The generated registry types timestamps `Date | null` (t.timestamps()
    // columns are nullable) — rows created through the ORM always have them.
    const createdAt = this.resource.createdAt
    const updatedAt = this.resource.updatedAt
    return {
      id:        this.resource.id,
      title:     this.resource.title,
      done:      this.resource.completed,
      createdAt: createdAt?.toISOString() ?? null,
      updatedAt: this.when(
        updatedAt != null && updatedAt.getTime() !== createdAt?.getTime(),
        updatedAt?.toISOString() ?? null,
      ),
    }
  }
}
