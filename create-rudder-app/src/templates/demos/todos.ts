// Todos demo — ORM + interactive CRUD via @rudderjs/router.
//
// Scaffolds five files under `app/Modules/Todo/` (Laravel-style self-contained
// module) plus the React view, and wires them into AppServiceProvider's boot()
// so the API routes register at app startup.

export function demosTodosView(): string {
  return `import '@/index.css'
import { useState, useRef } from 'react'
import type { Todo } from '../../Modules/Todo/TodoSchema.js'

interface TodosDemoProps {
  todos: Todo[]
}

export default function TodosDemo({ todos: initial }: TodosDemoProps) {
  const [todos, setTodos]     = useState<Todo[]>(initial)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function addTodo() {
    const title = inputRef.current?.value.trim()
    if (!title) return
    setLoading(true)
    const res = await fetch('/api/todos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title }),
    })
    const { data } = await res.json() as { data: Todo }
    setTodos(prev => [data, ...prev])
    if (inputRef.current) inputRef.current.value = ''
    setLoading(false)
  }

  async function toggleTodo(todo: Todo) {
    const res = await fetch(\`/api/todos/\${todo.id}\`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ completed: !todo.completed }),
    })
    const { data } = await res.json() as { data: Todo }
    setTodos(prev => prev.map(t => t.id === data.id ? data : t))
  }

  async function deleteTodo(id: string) {
    await fetch(\`/api/todos/\${id}\`, { method: 'DELETE' })
    setTodos(prev => prev.filter(t => t.id !== id))
  }

  const done    = todos.filter(t => t.completed).length
  const pending = todos.length - done

  return (
    <div className="page">
      <nav className="page-nav">
        <div className="brand">
          <span className="brand-dot" />
          RudderJS
        </div>
        <div className="nav-right">
          <a href="/demos" className="nav-link">Demos</a>
          <a href="/" className="nav-link">Home</a>
        </div>
      </nav>

      <section className="hero">
        <h1 className="hero-title">Todo List</h1>
        <p className="hero-lead">
          {pending} remaining · {done} completed
        </p>
        <p className="hero-meta">
          Rendered from <code className="inline-code">app/Views/Demos/Todos.tsx</code> via{' '}
          <code className="inline-code">view('demos.todos', &#123; todos &#125;)</code>.
          Initial data fetched by the controller, not the view.
        </p>
      </section>

      <section className="feature-section">
        <div className="demo-narrow">
          <div className="demo-card">
            <div className="input-row">
              <input
                ref={inputRef}
                className="form-input"
                placeholder="What needs to be done?"
                onKeyDown={e => e.key === 'Enter' && addTodo()}
              />
              <button className="button-primary" onClick={addTodo} disabled={loading}>
                {loading ? '...' : 'Add'}
              </button>
            </div>
          </div>

          <div className="demo-card">
            <div className="demo-card-header">
              <h2 className="demo-card-title">Tasks</h2>
            </div>
            <div className="demo-card-body">
              {todos.length === 0 && (
                <p className="empty-state">No todos yet. Add one above!</p>
              )}
              {todos.map(todo => (
                <div key={todo.id} className="list-row group">
                  <input
                    type="checkbox"
                    className="checkbox-input"
                    checked={todo.completed}
                    onChange={() => toggleTodo(todo)}
                  />
                  <span className={\`list-row-text\${todo.completed ? ' list-row-text-done' : ''}\`}>
                    {todo.title}
                  </span>
                  <button
                    onClick={() => deleteTodo(todo.id)}
                    className="list-row-delete"
                    aria-label="Delete"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
`
}

export function todoModelPrisma(): string {
  return `model Todo {
  id        String   @id @default(cuid())
  title     String
  completed Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`
}

export function todoSchema(): string {
  return `import { z } from 'zod'

export const TodoInputSchema = z.object({
  title:     z.string().min(1, 'Title is required'),
  completed: z.boolean().optional().default(false),
})

export const TodoUpdateSchema = z.object({
  title:     z.string().min(1).optional(),
  completed: z.boolean().optional(),
})

export type TodoInput  = z.infer<typeof TodoInputSchema>
export type TodoUpdate = z.infer<typeof TodoUpdateSchema>

export interface Todo {
  id:        string
  title:     string
  completed: boolean
  createdAt: Date
  updatedAt: Date
}
`
}

export function todoService(): string {
  return `import { Injectable, resolve } from '@rudderjs/core'
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
`
}

export function todoServiceProvider(): string {
  return `import { ServiceProvider } from '@rudderjs/core'
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

    router.delete('/api/todos/:id', async (req, res) => {
      await service.delete(req.params['id']!)
      res.status(204).send('')
    })
  }
}
`
}
