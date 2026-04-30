import { ServiceProvider } from '@rudderjs/core'
import { router } from '@rudderjs/router'
import { TodoService } from './TodoService.js'
import { TodoInputSchema, TodoUpdateSchema } from './TodoSchema.js'

export class TodoServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(TodoService, () => new TodoService())
  }

  override async boot(): Promise<void> {
    const service = this.app.make<TodoService>(TodoService)

    router.get('/api/todos', async (_req, res) => {
      const todos = await service.findAll()
      res.json({ data: todos })
    })

    router.post('/api/todos', async (req, res) => {
      const parsed = TodoInputSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(422).json({ errors: parsed.error.flatten().fieldErrors })
        return
      }
      const todo = await service.create(parsed.data)
      res.status(201).json({ data: todo })
    })

    router.patch('/api/todos/:id', async (req, res) => {
      const parsed = TodoUpdateSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(422).json({ errors: parsed.error.flatten().fieldErrors })
        return
      }
      const todo = await service.update(req.params['id']!, parsed.data)
      res.json({ data: todo })
    })

    router.delete('/api/todos/:id', async (_req, res) => {
      await service.delete(_req.params['id']!)
      res.status(204).send('')
    })
  }
}
