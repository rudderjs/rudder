'use client'

import { useState } from 'react'
import { useData } from 'vike-react/useData'
import { AdminLayout } from '../../../_components/AdminLayout.js'
import { FieldInput } from '../../../_components/FieldInput.js'
import type { Data } from './+data.js'

export default function CreatePage() {
  const { panelMeta, resourceMeta, pathSegment, slug } = useData<Data>()

  const formFields    = resourceMeta.fields.filter((f) => !f.hidden.includes('create'))
  const initialValues = Object.fromEntries(formFields.map((f) => [f.name, '']))
  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  function setValue(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: [] }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(values),
      })
      if (res.status === 422) {
        const body = await res.json() as { errors: Record<string, string[]> }
        setErrors(body.errors)
        return
      }
      if (res.ok) window.location.href = `/${pathSegment}/${slug}`
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout panelMeta={panelMeta} currentSlug={slug}>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm text-muted-foreground">
        <a href={`/${pathSegment}/${slug}`} className="hover:text-foreground transition-colors">
          {resourceMeta.label}
        </a>
        <span>/</span>
        <span className="text-foreground font-medium">New {resourceMeta.labelSingular}</span>
      </div>

      <div className="max-w-2xl">
        <div className="rounded-xl border bg-card p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {formFields.map((field) => (
              <div key={field.name}>
                {field.type !== 'boolean' && (
                  <label className="block text-sm font-medium mb-1.5">
                    {field.label}
                    {field.required && <span className="text-destructive ml-0.5">*</span>}
                  </label>
                )}
                <FieldInput field={field} value={values[field.name]} onChange={(v) => setValue(field.name, v)} />
                {errors[field.name]?.map((e) => (
                  <p key={e} className="mt-1 text-xs text-destructive">{e}</p>
                ))}
              </div>
            ))}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? 'Saving…' : `Create ${resourceMeta.labelSingular}`}
              </button>
              <a
                href={`/${pathSegment}/${slug}`}
                className="px-5 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </a>
            </div>
          </form>
        </div>
      </div>

    </AdminLayout>
  )
}
