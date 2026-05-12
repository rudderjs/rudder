// Localization demo — language switcher hits /api/i18n?locale=…
// The route uses runWithLocale + setLocale + trans() to render strings.
// Lang files at lang/<locale>/messages.json.

export function demosLocalizationView(): string {
  return `import { useEffect, useState } from 'react'
import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

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
    const res = await fetch(\`/api/i18n?locale=\${loc}\`)
    setData(await res.json() as I18nResponse)
  }

  useEffect(() => { load(locale) }, [locale])

  return (
    <div className="page">
      <SiteHeader />

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
`
}

export function demosLocalizationApiBlock(): string {
  return `// GET /api/i18n?locale=… — resolves the same keys in the requested locale.
router.get('/api/i18n', async (req, res) => {
  const { runWithLocale, setLocale, getLocale, trans } = await import('@rudderjs/localization')
  const requested = (req.query as Record<string, string>)['locale'] ?? 'en'

  const payload = await runWithLocale(requested, async () => {
    setLocale(requested)
    return {
      locale:   getLocale(),
      welcome:  await trans('messages.welcome'),
      greeting: await trans('messages.greeting', { name: 'World' }),
      items:    await trans('messages.items', 3),
    }
  })

  res.json(payload)
})`
}

export function langMessages(locale: 'en' | 'es' | 'ar'): string {
  if (locale === 'es') {
    return `{
  "welcome":  "¡Bienvenido a RudderJS!",
  "greeting": "Hola, :name!",
  "items":    "{0} sin elementos|{1} un elemento|{n} :count elementos"
}
`
  }
  if (locale === 'ar') {
    return `{
  "welcome":  "مرحباً بك في RudderJS!",
  "greeting": "مرحباً، :name!",
  "items":    "{0} لا توجد عناصر|{1} عنصر واحد|{n} :count عناصر"
}
`
  }
  return `{
  "welcome":  "Welcome to RudderJS!",
  "greeting": "Hello, :name!",
  "items":    "{0} no items|{1} one item|{n} :count items"
}
`
}
