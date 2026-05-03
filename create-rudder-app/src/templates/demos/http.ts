// HTTP client demo — fluent fetch with retry + timeout against a public API.

export function demosHttpView(): string {
  return `import { useState } from 'react'
import '@/index.css'

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
        <h1 className="hero-title">HTTP client</h1>
        <p className="hero-lead">
          Server-side <code className="inline-code">Http.get(url).retry(3, 200).timeout(5000)</code>{' '}
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
`
}

export function demosHttpApiBlock(): string {
  return `// GET /api/http/fetch?url=… — server-side HTTP with retry + timeout.
router.get('/api/http/fetch', async (req, res) => {
  const url = (req.query as Record<string, string>)['url']
  if (!url) return res.status(422).json({ message: 'url is required' })
  if (!/^https?:\\/\\//.test(url)) return res.status(422).json({ message: 'url must be http(s)' })

  const { Http } = await import('@rudderjs/http')
  const t0 = Date.now()
  try {
    const response = await Http.get(url).retry(3, 200).timeout(5000)
    let body: unknown = null
    try { body = response.json() } catch { body = response.body.slice(0, 600) }
    res.json({
      status:     response.status,
      ok:         response.ok(),
      durationMs: Date.now() - t0,
      url,
      body,
    })
  } catch (e) {
    res.status(502).json({ message: (e as Error).message ?? 'Request failed', durationMs: Date.now() - t0, url })
  }
})`
}
