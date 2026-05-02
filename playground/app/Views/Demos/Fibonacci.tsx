import { useState } from 'react'
import '@/index.css'

interface FibResponse {
  n:            number
  count:        number
  result:       number
  sequentialMs: number
  parallelMs:   number
  workers:      number
}

export default function FibonacciDemo() {
  const [n,       setN      ] = useState(36)
  const [count,   setCount  ] = useState(4)
  const [data,    setData   ] = useState<FibResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError  ] = useState<string | null>(null)

  async function run() {
    setLoading(true); setError(null); setData(null)
    try {
      const res  = await fetch(`/api/fib?n=${n}&count=${count}`)
      const body = await res.json() as FibResponse | { message: string }
      if (!res.ok) throw new Error((body as { message: string }).message ?? 'Failed')
      setData(body as FibResponse)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

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
        <h1 className="hero-title">Worker Threads</h1>
        <p className="hero-lead">
          Compute <code className="inline-code">fib(n)</code> N times — sequentially on the main thread, then
          in parallel via <code className="inline-code">@rudderjs/concurrency</code>'s worker pool. Watch the
          parallel cost stay flat as N grows (until you saturate workers).
        </p>
      </section>

      <section className="feature-section">
        <div className="form-card">
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ flex: 1 }}>
              <p className="form-label">n (Fibonacci index)</p>
              <input
                className="form-input"
                type="number"
                min={20}
                max={42}
                value={n}
                onChange={e => setN(Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <p className="form-label">count (parallel calls)</p>
              <input
                className="form-input"
                type="number"
                min={1}
                max={16}
                value={count}
                onChange={e => setCount(Number(e.target.value))}
              />
            </div>
          </div>

          <button
            className="form-submit"
            onClick={run}
            disabled={loading}
            style={{ marginBottom: '1rem' }}
          >
            {loading ? 'Computing…' : `Run ${count} × fib(${n})`}
          </button>

          {error && (
            <p className="form-error">{error}</p>
          )}

          {data && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '0.75rem' }}>
                <div style={{ padding: '0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border, #e5e7eb)' }}>
                  <p className="form-label" style={{ marginBottom: '0.25rem' }}>Sequential (main thread)</p>
                  <p style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>{data.sequentialMs}ms</p>
                  <p className="feature-desc" style={{ fontSize: '0.7rem', marginTop: '0.25rem' }}>
                    {data.count} × fib({data.n}) one after another, blocking the event loop
                  </p>
                </div>
                <div style={{ padding: '0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border, #e5e7eb)' }}>
                  <p className="form-label" style={{ marginBottom: '0.25rem' }}>Parallel ({data.workers} workers)</p>
                  <p style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>{data.parallelMs}ms</p>
                  <p className="feature-desc" style={{ fontSize: '0.7rem', marginTop: '0.25rem' }}>
                    same {data.count} tasks via <code>Concurrency.run([...])</code>
                  </p>
                </div>
              </div>

              <p className="feature-desc" style={{ fontSize: '0.85rem' }}>
                Result: <code>fib({data.n}) = {data.result.toLocaleString()}</code>
                {' · '}
                <strong>{Math.round((data.sequentialMs / Math.max(data.parallelMs, 1)) * 10) / 10}× faster</strong>
                {' '}via worker pool
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
