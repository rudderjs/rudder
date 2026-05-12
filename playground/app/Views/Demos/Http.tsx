import { useState } from 'react'
import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

interface HttpResponseShape {
  status:    number
  ok:        boolean
  durationMs: number
  url:       string
  body:      unknown
}

const ENDPOINTS = [
  { url: 'https://jsonplaceholder.typicode.com/todos/1',  label: 'Todo (works)' },
  { url: 'https://jsonplaceholder.typicode.com/users/1',  label: 'User (works)' },
  { url: 'https://httpstat.us/500?sleep=300',              label: 'Force 500 (retries 3×)' },
]

export default function HttpDemo() {
  const [url,  setUrl]     = useState(ENDPOINTS[0]!.url)
  const [data, setData]    = useState<HttpResponseShape | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function fetchUrl() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/http/fetch?url=' + encodeURIComponent(url))
      const body = await res.json() as HttpResponseShape | { message: string }
      if (!res.ok) throw new Error((body as { message: string }).message ?? 'Failed')
      setData(body as HttpResponseShape)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero-title">HTTP client</h1>
        <p className="hero-lead">
          Server-side <code className="inline-code">Http.retry(3, 200).timeout(5000).get(url)</code>{' '}
          against a public API. Pick a URL — the 500 endpoint exercises the retry path.
        </p>
      </section>

      <section className="feature-section" style={{ maxWidth: '40rem', margin: '0 auto' }}>
        <div className="form-card">
          <label className="form-label" htmlFor="http-url">URL</label>
          <select id="http-url" className="form-input" value={url} onChange={e => setUrl(e.target.value)} style={{ marginBottom: '0.75rem' }}>
            {ENDPOINTS.map(e => (
              <option key={e.url} value={e.url}>{e.label}</option>
            ))}
          </select>
          <button className="form-submit" onClick={fetchUrl} disabled={loading}>
            {loading ? 'Fetching…' : 'Fetch'}
          </button>
          {error && (
            <p className="form-error" style={{ marginTop: '1rem' }}>{error}</p>
          )}
          {data && (
            <div style={{ marginTop: '1rem' }}>
              <p className="feature-desc">
                <strong>{data.status}</strong> · {data.durationMs}ms · ok={String(data.ok)}
              </p>
              <pre style={{ marginTop: '0.5rem', padding: '0.75rem', borderRadius: '0.375rem', background: 'var(--muted, #f4f4f5)', fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(data.body, null, 2).slice(0, 600)}
              </pre>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
