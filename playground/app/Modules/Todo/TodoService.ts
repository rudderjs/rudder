import { Injectable } from '@rudderjs/core'
import { Todo as TodoModel } from 'App/Models/Todo.js'
import type { Todo, TodoInput, TodoUpdate } from './TodoSchema.js'

// Service over the Todo MODEL (not the raw adapter) so casts apply on every
// path: `completed` surfaces as a real boolean and timestamps as Dates —
// `res.json()` then serializes through the model's toJSON().
@Injectable()
export class TodoService {
  findAll(): Promise<Todo[]> {
    return TodoModel.query().orderBy('createdAt', 'DESC').get() as unknown as Promise<Todo[]>
  }

  findById(id: string): Promise<Todo | null> {
    return TodoModel.find(id) as unknown as Promise<Todo | null>
  }

  create(input: TodoInput): Promise<Todo> {
    return TodoModel.create(input) as unknown as Promise<Todo>
  }

  update(id: string, input: TodoUpdate): Promise<Todo> {
    // Drop undefined keys: Zod's `.optional()` produces `T | undefined` fields,
    // which exactOptionalPropertyTypes won't pass to UpdatePayload<Todo>.
    const data = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    )
    return TodoModel.update(id, data) as unknown as Promise<Todo>
  }

  async delete(id: string): Promise<void> {
    await TodoModel.delete(id)
  }
}
