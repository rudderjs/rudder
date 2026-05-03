import { useState } from 'react'
import { getCsrfToken } from '@rudderjs/middleware'
import '@/index.css'

interface FormFields {
  name:    string
  email:   string
  message: string
}

interface FormErrors {
  name?:    string
  email?:   string
  message?: string
}

interface FormState {
  status:      'idle' | 'loading' | 'success' | 'error'
  message?:    string
  errors?:     FormErrors
  statusCode?: number
}

function ContactForm({
  title,
  description,
  protected: isProtected,
}: {
  title:       string
  description: string
  protected:   boolean
}) {
  const [fields, setFields] = useState<FormFields>({ name: '', email: '', message: '' })
  const [state,  setState ] = useState<FormState>({ status: 'idle' })

  function setField(key: keyof FormFields, value: string) {
    setFields(f => ({ ...f, [key]: value }))
    if (state.errors?.[key]) {
      setState(s => ({ ...s, errors: { ...s.errors, [key]: undefined } }))
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState({ status: 'loading' })

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (isProtected) {
      headers['X-CSRF-Token'] = getCsrfToken()
    }

    const res = await fetch('/api/contact', {
      method:  'POST',
      headers,
      body:    JSON.stringify(fields),
    })

    const data = await res.json() as { ok?: boolean; message?: string; errors?: FormErrors }

    if (res.ok) {
      setState({ status: 'success', message: data.message ?? '' })
      setFields({ name: '', email: '', message: '' })
    } else if (res.status === 422) {
      setState({ status: 'error', errors: data.errors ?? {}, statusCode: 422 })
    } else {
      setState({ status: 'error', statusCode: res.status, message: data.message ?? 'Request failed.' })
    }
  }

  return (
    <div className="demo-card">
      <div className="demo-card-header">
        <h2 className="demo-card-title">{title}</h2>
        <p className="demo-card-desc">{description}</p>
      </div>
      <form onSubmit={submit} className="demo-stack">
        <div>
          <label className="form-label" htmlFor={`${title}-name`}>Name</label>
          <input
            id={`${title}-name`}
            className="form-input"
            placeholder="Jane Doe"
            value={fields.name}
            onChange={e => setField('name', e.target.value)}
            aria-invalid={!!state.errors?.name}
          />
          {state.errors?.name && (
            <p className="form-error-inline">{state.errors.name}</p>
          )}
        </div>

        <div>
          <label className="form-label" htmlFor={`${title}-email`}>Email</label>
          <input
            id={`${title}-email`}
            type="email"
            className="form-input"
            placeholder="jane@example.com"
            value={fields.email}
            onChange={e => setField('email', e.target.value)}
            aria-invalid={!!state.errors?.email}
          />
          {state.errors?.email && (
            <p className="form-error-inline">{state.errors.email}</p>
          )}
        </div>

        <div>
          <label className="form-label" htmlFor={`${title}-message`}>Message</label>
          <textarea
            id={`${title}-message`}
            className="form-textarea"
            placeholder="Your message here…"
            rows={4}
            value={fields.message}
            onChange={e => setField('message', e.target.value)}
            aria-invalid={!!state.errors?.message}
          />
          {state.errors?.message && (
            <p className="form-error-inline">{state.errors.message}</p>
          )}
        </div>

        <button type="submit" className="button-primary" disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Sending…' : 'Send message'}
        </button>

        {state.status === 'success' && (
          <div className="form-success">{state.message}</div>
        )}

        {state.status === 'error' && !state.errors && (
          <div className="form-error">
            <span style={{ fontWeight: 600 }}>{state.statusCode}</span> — {state.message}
          </div>
        )}
      </form>
    </div>
  )
}

export default function ContactDemo() {
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
        <h1 className="hero-title">CSRF &amp; Validation</h1>
        <p className="hero-lead">
          Both forms POST to <code className="inline-code">/api/contact</code>.
          The unprotected form omits <code className="inline-code">X-CSRF-Token</code> and gets a 419.
          The protected form reads the token from the cookie and passes server-side zod validation.
        </p>
        <p className="hero-meta">
          Rendered from <code className="inline-code">app/Views/Demos/Contact.tsx</code> via{' '}
          <code className="inline-code">view('demos.contact')</code>.
        </p>
      </section>

      <section className="feature-section">
        <div className="demo-card-grid">
          <ContactForm
            title="Unprotected form"
            description="No CSRF token is sent — expect a 419 CSRF_MISMATCH error."
            protected={false}
          />
          <ContactForm
            title="Protected form"
            description="Sends X-CSRF-Token from cookie. Fill all fields to pass zod validation."
            protected={true}
          />
        </div>
      </section>
    </div>
  )
}
