import '@/index.css'
import { useState } from 'react'
import { getCsrfToken } from '@rudderjs/middleware/client'

interface FormFields { name: string; email: string; message: string }
interface FormErrors { name?: string; email?: string; message?: string }

export default function ContactDemo() {
  const [fields, setFields] = useState<FormFields>({ name: '', email: '', message: '' })
  const [errors, setErrors] = useState<FormErrors>({})
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  function setField(key: keyof FormFields, value: string) {
    setFields(f => ({ ...f, [key]: value }))
    if (errors[key]) setErrors(e => ({ ...e, [key]: undefined }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrors({})

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    headers['X-CSRF-Token'] = getCsrfToken()

    const res  = await fetch('/api/contact', {
      method:  'POST',
      headers,
      body:    JSON.stringify(fields),
    })
    const data = await res.json() as { ok?: boolean; message?: string; errors?: FormErrors }

    if (res.ok) {
      setStatus('success')
      setMessage(data.message ?? 'Thanks!')
      setFields({ name: '', email: '', message: '' })
    } else if (res.status === 422) {
      setStatus('error')
      setErrors(data.errors ?? {})
    } else {
      setStatus('error')
      setMessage(`${res.status} — ${data.message ?? 'Request failed.'}`)
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
          <a href="/demos" className="nav-link">← Demos</a>
        </div>
      </nav>

      <section className="hero">
        <h1 className="hero-title">Contact</h1>
        <p className="hero-lead">
          POSTs to <code className="inline-code">/api/contact</code> with an X-CSRF-Token header.{' '}
          Server-side validated with Zod.
        </p>
      </section>

      <section className="feature-section" style={{ maxWidth: '32rem', margin: '0 auto' }}>
        <form onSubmit={submit} className="form-card">
          <div>
            <label className="form-label" htmlFor="name">Name</label>
            <input id="name" className="form-input" value={fields.name}
              onChange={e => setField('name', e.target.value)} />
            {errors.name && <p className="form-error">{errors.name}</p>}
          </div>
          <div>
            <label className="form-label" htmlFor="email">Email</label>
            <input id="email" type="email" className="form-input" value={fields.email}
              onChange={e => setField('email', e.target.value)} />
            {errors.email && <p className="form-error">{errors.email}</p>}
          </div>
          <div>
            <label className="form-label" htmlFor="message">Message</label>
            <textarea id="message" rows={4} className="form-input" value={fields.message}
              onChange={e => setField('message', e.target.value)} />
            {errors.message && <p className="form-error">{errors.message}</p>}
          </div>
          <button type="submit" className="form-submit" disabled={status === 'loading'}>
            {status === 'loading' ? 'Sending…' : 'Send message'}
          </button>
          {status === 'success' && <p className="form-success">{message}</p>}
          {status === 'error' && message && <p className="form-error">{message}</p>}
        </form>
      </section>
    </div>
  )
}
