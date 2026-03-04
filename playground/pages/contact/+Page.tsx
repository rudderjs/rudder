import '@/index.css'
import { useState } from 'react'
import { getCsrfToken } from '@boostkit/middleware'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface FormFields {
  name: string
  email: string
  message: string
}

interface FormErrors {
  name?: string
  email?: string
  message?: string
}

interface FormState {
  status: 'idle' | 'loading' | 'success' | 'error'
  message?: string
  errors?: FormErrors
  statusCode?: number
}

function ContactForm({
  title,
  description,
  protected: isProtected,
}: {
  title: string
  description: string
  protected: boolean
}) {
  const [fields, setFields] = useState<FormFields>({ name: '', email: '', message: '' })
  const [state, setState] = useState<FormState>({ status: 'idle' })

  function setField(key: keyof FormFields, value: string) {
    setFields(f => ({ ...f, [key]: value }))
    // Clear per-field error on change
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
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor={`${title}-name`}>Name</label>
            <Input
              id={`${title}-name`}
              placeholder="Jane Doe"
              value={fields.name}
              onChange={e => setField('name', e.target.value)}
              aria-invalid={!!state.errors?.name}
            />
            {state.errors?.name && (
              <p className="text-xs text-destructive">{state.errors.name}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor={`${title}-email`}>Email</label>
            <Input
              id={`${title}-email`}
              type="email"
              placeholder="jane@example.com"
              value={fields.email}
              onChange={e => setField('email', e.target.value)}
              aria-invalid={!!state.errors?.email}
            />
            {state.errors?.email && (
              <p className="text-xs text-destructive">{state.errors.email}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor={`${title}-message`}>Message</label>
            <Textarea
              id={`${title}-message`}
              placeholder="Your message here…"
              rows={4}
              value={fields.message}
              onChange={e => setField('message', e.target.value)}
              aria-invalid={!!state.errors?.message}
            />
            {state.errors?.message && (
              <p className="text-xs text-destructive">{state.errors.message}</p>
            )}
          </div>

          <Button type="submit" disabled={state.status === 'loading'}>
            {state.status === 'loading' ? 'Sending…' : 'Send message'}
          </Button>

          {state.status === 'success' && (
            <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-800 dark:text-green-300">
              {state.message}
            </div>
          )}

          {state.status === 'error' && !state.errors && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              <span className="font-medium">{state.statusCode}</span> — {state.message}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

export default function ContactPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-10 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">CSRF &amp; Validation Demo</h1>
        <p className="mt-2 text-muted-foreground text-sm max-w-lg">
          Both forms POST to <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/contact</code>.
          The unprotected form omits <code className="text-xs bg-muted px-1 py-0.5 rounded">X-CSRF-Token</code> and gets a 419.
          The protected form reads the token from the cookie and passes server-side zod validation.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 w-full max-w-3xl">
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

      <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← Back to home
      </a>
    </div>
  )
}
