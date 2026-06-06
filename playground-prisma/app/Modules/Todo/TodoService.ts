import { Injectable } from '@rudderjs/core'
import { resolve } from '@rudderjs/core'
import type { OrmAdapter } from '@rudderjs/orm'
import type { Todo, TodoInput, TodoUpdate } from './TodoSchema.js'

@Injectable()
export class TodoService {
  private get db(): OrmAdapter {
    return resolve<OrmAdapter>('db')
  }

  findAll(): Promise<Todo[]> {
    return this.db.query<Todo>('todo').orderBy('createdAt', 'DESC').get()
  }

  findById(id: string): Promise<Todo | null> {
    return this.db.query<Todo>('todo').find(id)
  }

  create(input: TodoInput): Promise<Todo> {
    return this.db.query<Todo>('todo').create(input)
  }

  update(id: string, input: TodoUpdate): Promise<Todo> {
    return this.db.query<Todo>('todo').update(id, input as Partial<Todo>)
  }

  delete(id: string): Promise<void> {
    return this.db.query<Todo>('todo').delete(id)
  }
}
