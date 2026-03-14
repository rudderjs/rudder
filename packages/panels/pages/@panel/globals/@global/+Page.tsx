'use client'

import { useState, useCallback } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { toast } from 'sonner'
import { Breadcrumbs }      from '../../../_components/Breadcrumbs.js'
import { SchemaRenderer }   from '../../../_components/edit/SchemaRenderer.js'
import type { SchemaItem }  from '../../../_lib/formHelpers.js'
import type { FieldMeta, SectionMeta, TabsMeta } from '@boostkit/panels'
import type { Data } from './+data.js'

function flattenGlobalFields(schema: SchemaItem[]): FieldMeta[] {
  const result: FieldMeta[] = []
  for (const item of schema) {
    if (item.type === 'section') {
      result.push(...(item as SectionMeta).fields)
    } else if (item.type === 'tabs') {
      for (const tab of (item as TabsMeta).tabs) result.push(...tab.fields)
    } else {
      result.push(item as FieldMeta)
    }
  }
  return result
}

export default function GlobalEditPage() {
  const config = useConfig()
  const { panelMeta, globalMeta, record, pathSegment, slug } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = panelMeta.i18n as Data['panelMeta']['i18n'] & Record<string, string>
  config({ title: `${globalMeta.label} — ${panelName}` })

  const uploadBase = `/${pathSegment}/api`
  const schema     = globalMeta.fields as SchemaItem[]
  const formFields = flattenGlobalFields(schema)

  const initialValues = Object.fromEntries(
    formFields.map((f) => [f.name, (record as Record<string, unknown>)?.[f.name] ?? ''])
  )

  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  const setValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: [] }))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const res = await fetch(`/${pathSegment}/api/_globals/${slug}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(values),
      })
      if (res.status === 422) {
        const body = await res.json() as { errors: Record<string, string[]> }
        setErrors(body.errors)
        return
      }
      if (!res.ok) {
        toast.error(i18n.saveError)
        return
      }
      toast.success(i18n.savedToast)
    } catch {
      toast.error(i18n.saveError)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Breadcrumbs crumbs={[
        { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}` },
        { label: globalMeta.label },
      ]} />

      <div className="max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <SchemaRenderer
            schema={schema}
            values={values}
            errors={errors}
            setValue={setValue}
            uploadBase={uploadBase}
            i18n={i18n}
            mode="edit"
          />
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? i18n.saving : i18n.save}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
