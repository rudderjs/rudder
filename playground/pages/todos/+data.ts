import { resolve } from '@rudderjs/core'
import { TodoService } from '../../app/Modules/Todo/TodoService.js'
import type { Todo } from '../../app/Modules/Todo/TodoSchema.js'

export type Data = { todos: Todo[] }

export async function data(): Promise<Data> {
  const service = resolve<TodoService>(TodoService)
  const todos   = await service.findAll()
  return { todos }
}
