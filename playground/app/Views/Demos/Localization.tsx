import { useEffect, useState } from 'react'
import '@/index.css'

interface I18nResponse {
  locale:   string
  greeting: string
  items:    string
  welcome:  string
}

const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'ar', label: 'العربية' },
]

export default function LocalizationDemo() {
  const [locale, setLocale] = useState('en')
  const [data,   setData]   = useState<I18nResponse | null>(null)

  async function load(loc: string) {
    const res = await fetch(`/api/i18n?locale=${loc}`)
    setData(await res.json() as I18nResponse)
  }

  useEffect(() => { load(locale) }, [locale])

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
        <h1 className="hero-title">Localization</h1>
        <p className="hero-lead">
          Pick a locale to fetch the same keys via{' '}
          <code className="inline-code">trans()</code> on the server. Strings live in{' '}
          <code className="inline-code">lang/&lt;locale&gt;/messages.json</code>.
        </p>
      </section>

      <section className="feature-section" style={{ maxWidth: '32rem', margin: '0 auto' }}>
        <div className="form-card">
          <div style={{ marginBottom: '1rem' }}>
            <label className="form-label" htmlFor="locale">Locale</label>
            <select
              id="locale"
              className="form-input"
              value={locale}
              onChange={e => setLocale(e.target.value)}
            >
              {LOCALES.map(l => (
                <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
              ))}
            </select>
          </div>

          {data && (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <p className="feature-desc"><strong>welcome:</strong> {data.welcome}</p>
              <p className="feature-desc"><strong>greeting:</strong> {data.greeting}</p>
              <p className="feature-desc"><strong>items (3):</strong> {data.items}</p>
              <p className="feature-desc" style={{ fontSize: '0.7rem', opacity: 0.7 }}>
                resolved server-side with locale = <code>{data.locale}</code>
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
