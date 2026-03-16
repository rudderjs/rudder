'use client'

import { useState, useEffect } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { navigate } from 'vike/client/router'
import { toast } from 'sonner'
import { Breadcrumbs }      from '../../../_components/Breadcrumbs.js'
import { SchemaRenderer }   from '../../../_components/edit/SchemaRenderer.js'
import { RestoreBanner }    from '../../../_components/edit/RestoreBanner.js'
import { useFormPersist }   from '../../../_hooks/useFormPersist.js'
import { useFieldPersist }  from '../../../_hooks/useFieldPersist.js'
import { flattenFormFields, t } from '../../../_lib/formHelpers.js'
import type { SchemaItem }  from '../../../_lib/formHelpers.js'
import type { FieldMeta }   from '@boostkit/panels'
import type { Data } from './+data.js'

function generateSlug(str: string): string {
  return str.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function CreatePage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, pathSegment, slug } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = panelMeta.i18n as Data['panelMeta']['i18n'] & Record<string, string>
  config({ title: `${t(i18n.create, { singular: resourceMeta.labelSingular })} — ${panelName}` })

  const uploadBase = `/${pathSegment}/api`
  const schema     = resourceMeta.fields as SchemaItem[]
  const formFields = flattenFormFields(schema, 'create')

  // Parse ?prefill[field]=value and ?back= from the URL
  const prefill: Record<string, string> = {}
  let backHref = `/${pathSegment}/${slug}`
  if (typeof window !== 'undefined') {
    new URLSearchParams(window.location.search).forEach((v, k) => {
      const m = k.match(/^prefill\[(.+)\]$/)
      if (m?.[1]) prefill[m[1]] = v
      else if (k === 'back') backHref = v
    })
  }

  const initialValues: Record<string, unknown> = Object.fromEntries(
    formFields.map((f) => {
      const prefillVal = prefill[f.name]
      if (prefillVal !== undefined) {
        if (f.type === 'belongsToMany') {
          return [f.name, prefillVal.split(',').map((s: string) => s.trim()).filter(Boolean)]
        }
        return [f.name, prefillVal]
      }
      if (f.extra?.['default'] !== undefined)     return [f.name, f.extra['default']]
      if (f.type === 'boolean' || f.type === 'toggle') return [f.name, false]
      if (f.type === 'belongsToMany')             return [f.name, []]
      if (f.type === 'belongsTo')                 return [f.name, null]
      return [f.name, '']
    }),
  )
  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  function setValue(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: [] }))
  }

  // ── Per-field persist (silent localStorage) ────────────────
  const fieldPersistKey = `bk:${pathSegment}:${slug}:create`
  const { clearPersistedFields } = useFieldPersist({
    storageKeyPrefix: fieldPersistKey,
    formFields,
    values,
    setValue,
  })

  // ── Form persist (localStorage backup) ─────────────────────
  const persistEnabled = resourceMeta.persistFormState ?? false
  const storageKey = `bk:${pathSegment}:${slug}:create`

  const persistOps = useFormPersist({
    storageKey,
    enabled: persistEnabled,
    values,
    initialValues,
    onRestore: (restored) => {
      setValues((prev) => ({ ...prev, ...restored }))
    },
  })

  // Auto-generate slug from source field
  useEffect(() => {
    const slugFields = formFields.filter((f) => f.type === 'slug' && f.extra?.['from'])
    for (const slugField of slugFields) {
      const sourceField = String(slugField.extra?.['from'] ?? '')
      const sourceValue = String(values[sourceField] ?? '')
      const currentSlug = String(values[slugField.name] ?? '')
      if (!currentSlug || currentSlug === generateSlug(currentSlug)) {
        setValues((prev) => ({ ...prev, [slugField.name]: generateSlug(sourceValue) }))
      }
    }
  }, [Object.values(values).join(',')])

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
      if (res.ok) {
        persistOps.clearDraft()
        clearPersistedFields()
        toast.success(t(i18n.createdToast, { singular: resourceMeta.labelSingular }))
        void navigate(backHref)
      } else {
        toast.error(i18n.createError)
      }
    } catch {
      toast.error(i18n.createError)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Breadcrumbs crumbs={[
        { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}/${slug}` },
        { label: resourceMeta.label, href: `/${pathSegment}/${slug}` },
        { label: t(i18n.create, { singular: resourceMeta.labelSingular }) },
      ]} />

      {persistOps.showBanner && persistOps.storedTimestamp && (
        <RestoreBanner
          timestamp={persistOps.storedTimestamp}
          onRestore={persistOps.restore}
          onDismiss={persistOps.dismiss}
          i18n={i18n}
        />
      )}

      <div className="max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <SchemaRenderer
            schema={schema}
            values={values}
            errors={errors}
            setValue={setValue}
            uploadBase={uploadBase}
            i18n={i18n}
            mode="create"
          />
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? i18n.creating : t(i18n.create, { singular: resourceMeta.labelSingular })}
            </button>
            <a
              href={backHref}
              className="px-5 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {i18n.cancel}
            </a>
          </div>
        </form>
      </div>
    </>
  )
}
