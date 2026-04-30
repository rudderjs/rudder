import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
    <div className="min-h-svh bg-background p-8">
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Todo List</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pending} remaining · {done} completed
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Rendered from <code>app/Views/Demos/Todos.tsx</code> via{' '}
            <code>view('demos.todos', &#123; todos &#125;)</code>. Initial data fetched
            by the controller, not the view.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                placeholder="What needs to be done?"
                onKeyDown={e => e.key === 'Enter' && addTodo()}
              />
              <Button onClick={addTodo} disabled={loading}>
                {loading ? '...' : 'Add'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 pb-4">
            {todos.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No todos yet. Add one above!
              </p>
            )}
            {todos.map(todo => (
              <div
                key={todo.id}
                className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50 group"
              >
                <Checkbox
                  checked={todo.completed}
                  onCheckedChange={() => toggleTodo(todo)}
                />
                <span className={`flex-1 text-sm ${todo.completed ? 'line-through text-muted-foreground' : ''}`}>
                  {todo.title}
                </span>
                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive text-xs transition-opacity"
                >
                  ✕
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
