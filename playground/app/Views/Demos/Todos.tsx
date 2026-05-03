import { useState, useRef } from 'react'
import '@/index.css'
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
    const res = await fetch(`/api/todos/${todo.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ completed: !todo.completed }),
    })
    const { data } = await res.json() as { data: Todo }
    setTodos(prev => prev.map(t => t.id === data.id ? data : t))
  }

  async function deleteTodo(id: string) {
    await fetch(`/api/todos/${id}`, { method: 'DELETE' })
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
                  <span className={`list-row-text${todo.completed ? ' list-row-text-done' : ''}`}>
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
