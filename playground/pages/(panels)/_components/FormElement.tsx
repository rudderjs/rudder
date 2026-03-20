'use client'

import { useState } from 'react'
import type { FormElementMeta, PanelI18n, FieldMeta } from '@boostkit/panels'
import { FieldInput } from './FieldInput.js'

interface FormElementProps {
  form:       FormElementMeta
  panelPath:  string
  i18n:       PanelI18n
}

export function FormElement({ form, panelPath, i18n }: FormElementProps) {
  const [values,       setValues]       = useState<Record<string, unknown>>({})
  const [submitting,   setSubmitting]   = useState(false)
  const [submitted,    setSubmitted]    = useState(false)
  const [serverError,  setServerError]  = useState<string | null>(null)
  const [fieldErrors,  setFieldErrors]  = useState<Record<string, string>>({})

  function handleChange(name: string, value: unknown) {
    setValues(prev => ({ ...prev, [name]: value }))
    setFieldErrors(prev => { const n = { ...prev }; delete n[name]; return n })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setServerError(null)

    const apiBase = panelPath.replace(/\/$/, '') + '/api'

    try {
      const res = await fetch(`${apiBase}/_forms/${form.id}/submit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(values),
      })

      if (res.ok) {
        setSubmitted(true)
      } else {
        const body = await res.json() as { message?: string; errors?: Record<string, string> }
        if (body.errors) {
          setFieldErrors(body.errors)
        } else {
          setServerError(body.message ?? 'Submission failed.')
        }
      }
    } catch {
      setServerError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          {form.successMessage ?? 'Submitted successfully.'}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {form.fields.map(item => {
          const field = item as FieldMeta
          if (!field.name) return null
          return (
            <div key={field.name} className="flex flex-col gap-1.5">
              {field.label && (
                <label className="text-sm font-medium leading-none">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
              )}
              <FieldInput
                field={field}
                value={values[field.name] ?? ''}
                onChange={v => handleChange(field.name, v)}
                uploadBase={panelPath.replace(/\/$/, '') + '/api'}
                i18n={i18n}
              />
              {fieldErrors[field.name] && (
                <p className="text-xs text-destructive">{fieldErrors[field.name]}</p>
              )}
            </div>
          )
        })}

        {serverError && (
          <p className="text-sm text-destructive">{serverError}</p>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {submitting ? '...' : (form.submitLabel ?? 'Submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
