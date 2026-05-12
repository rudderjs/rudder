import { useState } from 'react'
import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

// Override the id-derived URL — `'demos.browser'` would resolve to
// `/demos/browser` by default; we declare it explicitly so SPA nav
// matches the controller route registered in `routes/web.ts`.
export const route = '/demos/browser'

interface AgentStep {
  action: string         // e.g. 'left_click [400, 200]', 'screenshot', 'type "hello"'
  result: string         // tool result (text or '[image]')
  isError: boolean
}

interface RunResult {
  ok:        boolean
  text?:     string      // final assistant text
  steps?:    AgentStep[] // computer-use actions the model emitted
  usage?:    { inputTokens: number; outputTokens: number; totalTokens: number }
  error?:    string      // friendly error message
  errorHint?: string     // optional follow-up guidance (e.g. install command)
}

const DEFAULT_URL   = 'https://example.com'
const DEFAULT_QUERY = 'What is the title of this page?'

export default function BrowserDemo() {
  const [url,     setUrl]     = useState(DEFAULT_URL)
  const [query,   setQuery]   = useState(DEFAULT_QUERY)
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<RunResult | null>(null)

  async function run() {
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/browser/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, query }),
      })
      setResult(await res.json() as RunResult)
    } catch (err) {
      setResult({
        ok:    false,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero-title">Computer-use browser agent</h1>
        <p className="hero-lead">
          Drives a real headless Chromium via{' '}
          <code className="inline-code">computerUseTool({'{ page }'})</code> from{' '}
          <code className="inline-code">@rudderjs/ai/computer-use</code>. The agent emits actions in
          Anthropic&apos;s native <code className="inline-code">computer_20250124</code> vocabulary;
          our adapter routes them to Playwright server-side.
        </p>
        <p className="hero-lead" style={{ fontSize: '0.85rem', opacity: 0.75 }}>
          Requirements: <code className="inline-code">ANTHROPIC_API_KEY</code> in{' '}
          <code className="inline-code">.env</code> +{' '}
          <code className="inline-code">npx playwright install chromium</code>. Capped at 15 actions
          per run (~$0.10–0.30 worst case in image tokens).
        </p>
      </section>

      <section className="feature-section">
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>URL</span>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              disabled={loading}
              style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #ccc', fontFamily: 'monospace' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Question for the agent</span>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              disabled={loading}
              style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #ccc' }}
            />
          </label>

          <button
            type="button"
            onClick={run}
            disabled={loading || !url || !query}
            style={{
              padding:      '0.75rem 1.5rem',
              borderRadius: 6,
              border:       'none',
              background:   loading ? '#999' : '#2563eb',
              color:        'white',
              fontWeight:   600,
              cursor:       loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? 'Driving the browser…' : 'Run agent'}
          </button>

          {result && !result.ok && (
            <div style={{ padding: '1rem', borderRadius: 6, background: '#fee2e2', color: '#991b1b' }}>
              <strong>Error:</strong> {result.error}
              {result.errorHint && (
                <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>{result.errorHint}</p>
              )}
            </div>
          )}

          {result?.ok && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ padding: '1rem', borderRadius: 6, background: '#dcfce7', color: '#166534' }}>
                <strong>Answer:</strong>
                <p style={{ margin: '0.5rem 0 0 0', whiteSpace: 'pre-wrap' }}>{result.text}</p>
              </div>

              {result.usage && (
                <p style={{ fontSize: '0.8rem', opacity: 0.7, margin: 0 }}>
                  Tokens: {result.usage.totalTokens.toLocaleString()} (
                  {result.usage.inputTokens.toLocaleString()} in / {result.usage.outputTokens.toLocaleString()} out)
                </p>
              )}

              {result.steps && result.steps.length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                    Steps ({result.steps.length})
                  </summary>
                  <ol style={{ paddingLeft: '1.5rem', marginTop: '0.5rem' }}>
                    {result.steps.map((step, i) => (
                      <li key={i} style={{ marginBottom: '0.5rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                        <strong>{step.action}</strong>
                        <span style={{ opacity: step.isError ? 1 : 0.7, color: step.isError ? '#991b1b' : 'inherit' }}>
                          {' → '}{step.result}
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
