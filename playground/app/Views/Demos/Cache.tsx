import { useState } from 'react'
import '@/index.css'

interface CacheResponse {
  views: number
  key:   string
}

export default function CacheDemo() {
  const [data, setData] = useState<CacheResponse | null>(null)
  const [loading, setLoading] = useState(false)

  async function bump() {
    setLoading(true)
    try {
      const res = await fetch('/api/cache/views', { method: 'POST' })
      setData(await res.json() as CacheResponse)
    } finally {
      setLoading(false)
    }
  }

  async function clear() {
    setLoading(true)
    try {
      await fetch('/api/cache/views', { method: 'DELETE' })
      setData({ views: 0, key: 'demos:views' })
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
        <h1 className="hero-title">Cache counter</h1>
        <p className="hero-lead">
          Click "Bump" to read the current value via <code className="inline-code">Cache.get</code>,
          increment it, and write it back via <code className="inline-code">Cache.set</code>.
          Default driver is in-memory; swap it via <code className="inline-code">config/cache.ts</code>.
        </p>
      </section>

      <section className="feature-section" style={{ maxWidth: '32rem', margin: '0 auto' }}>
        <div className="form-card" style={{ textAlign: 'center' }}>
          <p className="form-label" style={{ marginBottom: '0.5rem' }}>Views recorded</p>
          <p style={{ fontSize: '3rem', fontWeight: 700, margin: '0.5rem 0' }}>
            {data?.views ?? '—'}
          </p>
          <p className="feature-desc" style={{ fontSize: '0.7rem', marginBottom: '1rem' }}>
            key: <code>{data?.key ?? 'demos:views'}</code>
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="form-submit" onClick={bump} disabled={loading} style={{ flex: 1 }}>
              {loading ? '…' : 'Bump'}
            </button>
            <button onClick={clear} disabled={loading} style={{ padding: '0.5rem 1rem', borderRadius: '0.375rem', border: '1px solid var(--border, #e5e7eb)', background: 'transparent', cursor: 'pointer' }}>
              Clear
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
