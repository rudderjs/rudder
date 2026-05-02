import { useState } from 'react'
import '@/index.css'

interface CommandResult {
  command:  string
  ok:       boolean
  exitCode: number
  duration: number   // ms
  stdout:   string
  stderr:   string
}

interface SystemInfoResponse {
  results:    CommandResult[]
  totalMs:    number
  parallelMs: number
}

export default function SystemInfo() {
  const [data,    setData   ] = useState<SystemInfoResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError  ] = useState<string | null>(null)

  async function run() {
    setLoading(true); setError(null)
    try {
      const res  = await fetch('/api/system-info')
      const body = await res.json() as SystemInfoResponse | { message: string }
      if (!res.ok) throw new Error((body as { message: string }).message ?? 'Failed')
      setData(body as SystemInfoResponse)
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
        <h1 className="hero-title">System Info</h1>
        <p className="hero-lead">
          Three shell commands run in parallel via{' '}
          <code className="inline-code">@rudderjs/process</code> —{' '}
          <code className="inline-code">git rev-parse HEAD</code>,{' '}
          <code className="inline-code">node --version</code>,{' '}
          <code className="inline-code">uptime</code>. Click run to dispatch.
        </p>
      </section>

      <section className="feature-section">
        <div className="form-card">
          <button
            className="form-submit"
            onClick={run}
            disabled={loading}
            style={{ marginBottom: '1rem' }}
          >
            {loading ? 'Running…' : 'Run commands'}
          </button>

          {error && (
            <p className="form-error">{error}</p>
          )}

          {data && (
            <>
              <p className="feature-desc" style={{ fontSize: '0.75rem', marginBottom: '0.75rem' }}>
                3 commands · sequential cost {data.totalMs}ms · parallel cost {data.parallelMs}ms
                {' · '}
                <strong>{Math.round((1 - data.parallelMs / data.totalMs) * 100)}% faster</strong> via{' '}
                <code className="inline-code">Process.pool()</code>
              </p>

              {data.results.map((r, i) => (
                <div key={i} style={{ marginBottom: '0.75rem', padding: '0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border, #e5e7eb)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <code style={{ fontSize: '0.85rem', fontWeight: 600 }}>{r.command}</code>
                    <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>
                      exit {r.exitCode} · {r.duration}ms
                    </span>
                  </div>
                  {r.stdout && (
                    <pre style={{ margin: 0, padding: '0.5rem', borderRadius: '0.25rem', background: 'var(--muted, #f4f4f5)', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{r.stdout}</pre>
                  )}
                  {r.stderr && (
                    <pre style={{ margin: '0.25rem 0 0', padding: '0.5rem', borderRadius: '0.25rem', background: 'var(--destructive-bg, #fef2f2)', color: 'var(--destructive, #b91c1c)', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{r.stderr}</pre>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
