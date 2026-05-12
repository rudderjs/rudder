// Queue dispatch demo — Job class in app/Jobs/ + dispatch endpoint that
// enqueues it. Default driver is in-memory; the worker drains during dev.

export function demosQueueView(): string {
  return `import { useState } from 'react'
import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

interface QueueResponse {
  ok:           boolean
  queue:        string
  dispatchedAt: string
}

export default function QueueDemo() {
  const [results, setResults] = useState<QueueResponse[]>([])
  const [loading, setLoading] = useState(false)

  async function dispatch() {
    setLoading(true)
    try {
      const res  = await fetch('/api/queue/dispatch', { method: 'POST' })
      const data = await res.json() as QueueResponse
      setResults(prev => [data, ...prev].slice(0, 10))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero-title">Queue dispatch</h1>
        <p className="hero-lead">
          Click to dispatch <code className="inline-code">ExampleJob</code> via{' '}
          <code className="inline-code">@rudderjs/queue</code>. The handler logs to the
          server terminal — install <code className="inline-code">@rudderjs/horizon</code> to see
          dispatched jobs in a UI.
        </p>
      </section>

      <section className="feature-section" style={{ maxWidth: '32rem', margin: '0 auto' }}>
        <div className="form-card">
          <button className="form-submit" onClick={dispatch} disabled={loading} style={{ marginBottom: '1rem' }}>
            {loading ? 'Dispatching…' : 'Dispatch ExampleJob'}
          </button>
          {results.length === 0 && (
            <p className="feature-desc" style={{ fontSize: '0.75rem', textAlign: 'center' }}>
              No dispatches yet.
            </p>
          )}
          {results.map((r, i) => (
            <p key={i} className="feature-desc" style={{ fontSize: '0.75rem', fontFamily: 'monospace', marginBottom: '0.25rem' }}>
              · {r.dispatchedAt} · queue={r.queue}
            </p>
          ))}
        </div>
      </section>
    </div>
  )
}
`
}

export function exampleJob(): string {
  return `import { Job } from '@rudderjs/queue'

/**
 * Example job for the queue demo. Logs to the server terminal when run
 * by the worker. Replace with whatever async work the queue should handle
 * (sending mail, generating reports, syncing third-party data, …).
 */
export class ExampleJob extends Job {
  static override queue   = 'default'
  static override retries = 3

  constructor(private readonly payload: string = 'hello') {
    super()
  }

  async handle(): Promise<void> {
    console.log(\`[ExampleJob] handling: \${this.payload}\`)
  }

  failed(error: unknown): void {
    console.error('[ExampleJob] failed after all retries:', error)
  }
}
`
}

export function demosQueueApiBlock(): string {
  return `// POST /api/queue/dispatch — enqueue ExampleJob. Worker drains it during dev.
router.post('/api/queue/dispatch', async (_req, res) => {
  const { ExampleJob } = await import('../app/Jobs/ExampleJob.ts')
  await ExampleJob.dispatch('hello from /api/queue/dispatch').send()
  res.json({ ok: true, queue: 'default', dispatchedAt: new Date().toISOString() })
})`
}
