'use client'

import { useState } from 'react'
import { useData } from 'vike-react/useData'
import { AdminLayout } from '../../../_components/AdminLayout.js'
import { FieldInput } from '../../../_components/FieldInput.js'
import type { Data } from './+data.js'

export default function EditPage() {
  const { panelMeta, resourceMeta, record, slug, id } = useData<Data>()

  if (!record) {
    return (
      <AdminLayout panelMeta={panelMeta} currentSlug={slug}>
        <p className="text-slate-500">Record not found.</p>
      </AdminLayout>
    )
  }

  const formFields = resourceMeta.fields.filter((f) => !f.hidden.includes('edit'))

  const initialValues = Object.fromEntries(
    formFields.map((f) => [f.name, (record as Record<string, unknown>)[f.name] ?? '']),
  )
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
      const res = await fetch(`/admin/api/${slug}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })

      if (res.status === 422) {
        const body = await res.json() as { errors: Record<string, string[]> }
        setErrors(body.errors)
        return
      }

      if (res.ok) {
        window.location.href = `/admin/${slug}`
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout panelMeta={panelMeta} currentSlug={slug}>

      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-6 text-sm text-slate-500">
        <a href={`/admin/${slug}`} className="hover:text-slate-700">{resourceMeta.label}</a>
        <span>/</span>
        <span className="text-slate-900 font-medium">Edit {resourceMeta.labelSingular}</span>
      </div>

      {/* ── Form ──────────────────────────────────────────── */}
      <div className="max-w-2xl">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {formFields.map((field) => (
              <div key={field.name}>
                {field.type !== 'boolean' && (
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                )}
                <FieldInput
                  field={field}
                  value={values[field.name]}
                  onChange={(v: unknown) => setValue(field.name, v)}
                />
                {errors[field.name]?.map((e) => (
                  <p key={e} className="mt-1 text-xs text-red-600">{e}</p>
                ))}
              </div>
            ))}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <a
                href={`/admin/${slug}`}
                className="px-5 py-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
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
