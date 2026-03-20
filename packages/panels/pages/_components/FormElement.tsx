'use client'

import { useState, useCallback, useEffect } from 'react'
import type { FormElementMeta, PanelI18n, FieldMeta } from '@boostkit/panels'
import { FieldInput } from './FieldInput.js'

interface FormElementProps {
  form:       FormElementMeta
  panelPath:  string
  i18n:       PanelI18n
}

export function FormElement({ form, panelPath, i18n }: FormElementProps) {
  const pathSegment = panelPath.replace(/^\//, '')

  // Build a map of field persist modes for quick lookup
  const fieldPersistModes = new Map<string, string>()
  for (const item of form.fields) {
    const field = item as FieldMeta
    if (field.name && field.persist) {
      fieldPersistModes.set(field.name, typeof field.persist === 'string' ? field.persist : 'yjs')
    }
  }

  // Merge: field defaults → localStorage/url restored → SSR initialValues
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const result: Record<string, unknown> = {}

    // 1. Field defaults (static)
    for (const item of form.fields) {
      const field = item as FieldMeta
      if (field.name && field.defaultValue !== undefined) {
        result[field.name] = field.defaultValue
      }
    }

    // 2. Restore from localStorage (client-side only)
    if (typeof window !== 'undefined') {
      for (const [fieldName, mode] of fieldPersistModes) {
        if (mode === 'localStorage') {
          try {
            const stored = localStorage.getItem(`form:${form.id}:${fieldName}`)
            if (stored !== null) result[fieldName] = JSON.parse(stored)
          } catch { /* ignore */ }
        }
        // URL mode: read from current URL search params
        if (mode === 'url') {
          const url = new URL(window.location.href)
          const urlKey = `${form.id}_${fieldName}`
          const urlValue = url.searchParams.get(urlKey)
          if (urlValue !== null) result[fieldName] = urlValue
        }
      }
    }

    // 3. SSR initialValues override everything (includes .data(fn), url/session from SSR)
    const initial = (form as { initialValues?: Record<string, unknown> }).initialValues
    if (initial) Object.assign(result, initial)

    return result
  })
  const [submitting,   setSubmitting]   = useState(false)
  const [submitted,    setSubmitted]    = useState(false)
  const [serverError,  setServerError]  = useState<string | null>(null)
  const [fieldErrors,  setFieldErrors]  = useState<Record<string, string>>({})

  // Restore localStorage values after hydration (SSR can't read localStorage)
  useEffect(() => {
    const restored: Record<string, unknown> = {}
    for (const [fieldName, mode] of fieldPersistModes) {
      if (mode === 'localStorage') {
        try {
          const stored = localStorage.getItem(`form:${form.id}:${fieldName}`)
          if (stored !== null) restored[fieldName] = JSON.parse(stored)
        } catch { /* ignore */ }
      }
    }
    if (Object.keys(restored).length > 0) {
      setValues(prev => ({ ...prev, ...restored }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist a field value based on its persist mode
  const persistFieldValue = useCallback((name: string, value: unknown) => {
    const mode = fieldPersistModes.get(name)
    if (!mode) return

    if (mode === 'localStorage' && typeof window !== 'undefined') {
      localStorage.setItem(`form:${form.id}:${name}`, JSON.stringify(value))
    }

    if (mode === 'url' && typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      const urlKey = `${form.id}_${name}`
      const strValue = value === null || value === undefined || value === '' ? null : String(value)
      if (strValue) url.searchParams.set(urlKey, strValue)
      else url.searchParams.delete(urlKey)
      window.history.replaceState(null, '', url.pathname + url.search)
    }

    if (mode === 'session') {
      fetch(`/${pathSegment}/api/_forms/${form.id}/persist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: name, value }),
      }).catch(() => {}) // fire-and-forget
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id, pathSegment])

  function handleChange(name: string, value: unknown) {
    setValues(prev => ({ ...prev, [name]: value }))
    setFieldErrors(prev => { const n = { ...prev }; delete n[name]; return n })
    persistFieldValue(name, value)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setServerError(null)

    const apiBase = panelPath.replace(/\/$/, '') + '/api'
    const submitUrl = (form as { action?: string }).action ?? `${apiBase}/_forms/${form.id}/submit`
    const submitMethod = (form as { method?: string }).method ?? 'POST'

    try {
      const res = await fetch(submitUrl, {
        method:  submitMethod,
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
      {(form as { description?: string }).description && (
        <p className="text-sm text-muted-foreground mb-4">{(form as { description?: string }).description}</p>
      )}
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
