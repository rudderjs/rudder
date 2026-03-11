'use client'

import { useState, useEffect } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { navigate } from 'vike/client/router'
import { toast } from 'sonner'
import { Breadcrumbs } from '../../../_components/Breadcrumbs.js'
import { FieldInput } from '../../../_components/FieldInput.js'
import type { FieldMeta, SectionMeta, TabsMeta } from '@boostkit/panels'
import type { Data } from './+data.js'

type SchemaItem = FieldMeta | SectionMeta | TabsMeta

function generateSlug(str: string): string {
  return str.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function flattenFormFields(schema: SchemaItem[], mode: 'create' | 'edit'): FieldMeta[] {
  const result: FieldMeta[] = []
  function collect(fields: FieldMeta[]) {
    for (const f of fields) {
      if (!f.hidden.includes(mode)) result.push(f)
    }
  }
  for (const item of schema) {
    if (item.type === 'section') {
      collect((item as SectionMeta).fields)
    } else if (item.type === 'tabs') {
      for (const tab of (item as TabsMeta).tabs) collect(tab.fields)
    } else {
      const f = item as FieldMeta
      if (!f.hidden.includes(mode)) result.push(f)
    }
  }
  return result
}

export default function CreatePage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, pathSegment, slug } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  config({ title: `New ${resourceMeta.labelSingular} — ${panelName}` })

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
          // prefill value is a single ID or comma-separated IDs → array
          return [f.name, prefillVal.split(',').map(s => s.trim()).filter(Boolean)]
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
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState<Record<string, number>>({})

  function setValue(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: [] }))
  }

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
        toast.success(`${resourceMeta.labelSingular} created successfully.`)
        void navigate(backHref)
      } else {
        toast.error('Something went wrong. Please try again.')
      }
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function renderField(field: FieldMeta) {
    return (
      <div key={field.name}>
        {field.type !== 'boolean' && field.type !== 'toggle' && field.type !== 'hidden' && (
          <label className="block text-sm font-medium mb-1.5">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </label>
        )}
        <FieldInput field={field} value={values[field.name]} onChange={(v) => setValue(field.name, v)} uploadBase={uploadBase} />
        {errors[field.name]?.map((e) => (
          <p key={e} className="mt-1 text-xs text-destructive">{e}</p>
        ))}
      </div>
    )
  }

  function renderSchemaItem(item: SchemaItem, index: number) {
    // ── Section ───────────────────────────────────────────
    if (item.type === 'section') {
      const section  = item as SectionMeta
      const key      = `section-${index}`
      const fields   = section.fields.filter((f) => !f.hidden.includes('create'))
      const open     = section.collapsible ? !(collapsedSections[key] ?? section.collapsed) : true

      const gridCls = section.columns === 2 ? 'grid grid-cols-2 gap-4'
                    : section.columns === 3 ? 'grid grid-cols-3 gap-4'
                    : 'flex flex-col gap-4'

      return (
        <div key={key} className="rounded-xl border border-border bg-card">
          <div
            className={['flex items-center justify-between px-5 py-3 bg-muted/40 border-b border-border', section.collapsible ? 'cursor-pointer select-none' : ''].join(' ')}
            onClick={() => section.collapsible && setCollapsedSections((p) => ({ ...p, [key]: !(p[key] ?? section.collapsed) }))}
          >
            <div>
              <p className="text-sm font-semibold">{section.title}</p>
              {section.description && <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>}
            </div>
            {section.collapsible && (
              <span className="text-muted-foreground text-sm">{open ? '▲' : '▼'}</span>
            )}
          </div>
          {open && (
            <div className={`p-5 ${gridCls}`}>
              {fields.map((f) => renderField(f))}
            </div>
          )}
        </div>
      )
    }

    // ── Tabs ─────────────────────────────────────────────
    if (item.type === 'tabs') {
      const tabs = item as TabsMeta
      const key  = `tabs-${index}`
      const active = activeTab[key] ?? 0

      return (
        <div key={key} className="rounded-xl border border-border bg-card">
          <div className="flex border-b border-border bg-muted/40">
            {tabs.tabs.map((tab, i) => (
              <button
                key={tab.label}
                type="button"
                onClick={() => setActiveTab((p) => ({ ...p, [key]: i }))}
                className={[
                  'px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                  i === active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="p-5 flex flex-col gap-4">
            {(tabs.tabs[active]?.fields ?? []).filter((f) => !f.hidden.includes('create')).map((f) => renderField(f))}
          </div>
        </div>
      )
    }

    // ── Regular field ─────────────────────────────────────
    return renderField(item as FieldMeta)
  }

  return (
    <>

      <Breadcrumbs crumbs={[
        { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}/${slug}` },
        { label: resourceMeta.label, href: `/${pathSegment}/${slug}` },
        { label: `New ${resourceMeta.labelSingular}` },
      ]} />

      <div className="max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {schema
            .filter((item) => {
              if (item.type === 'section' || item.type === 'tabs') return true
              return !(item as FieldMeta).hidden.includes('create')
            })
            .map((item, i) => renderSchemaItem(item, i))
          }
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving…' : `Create ${resourceMeta.labelSingular}`}
            </button>
            <a
              href={backHref}
              className="px-5 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </a>
          </div>
        </form>
      </div>

    </>
  )
}
