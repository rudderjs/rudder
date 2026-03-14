'use client'

import { useState, useCallback } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { toast } from 'sonner'
import { Breadcrumbs } from '../../../_components/Breadcrumbs.js'
import { FieldInput } from '../../../_components/FieldInput.js'
import type { FieldMeta, SectionMeta, TabsMeta, PanelI18n } from '@boostkit/panels'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.js'
import type { Data } from './+data.js'

type ConditionOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not_in' | 'truthy' | 'falsy'

interface Condition {
  type:  'show' | 'hide' | 'disabled'
  field: string
  op:    ConditionOp
  value: unknown
}

function evalCondition(cond: Condition, values: Record<string, unknown>): boolean {
  const val = values[cond.field]
  switch (cond.op) {
    case '=':       return val === cond.value
    case '!=':      return val !== cond.value
    case '>':       return (val as number)  >  (cond.value as number)
    case '>=':      return (val as number)  >= (cond.value as number)
    case '<':       return (val as number)  <  (cond.value as number)
    case '<=':      return (val as number)  <= (cond.value as number)
    case 'in':      return (cond.value as unknown[]).includes(val)
    case 'not_in':  return !(cond.value as unknown[]).includes(val)
    case 'truthy':  return !!val
    case 'falsy':   return !val
    default:        return true
  }
}

function isFieldVisible(field: { conditions?: Condition[] }, values: Record<string, unknown>): boolean {
  if (!field.conditions?.length) return true
  for (const cond of field.conditions) {
    const match = evalCondition(cond, values)
    if (cond.type === 'show' && !match) return false
    if (cond.type === 'hide' &&  match) return false
  }
  return true
}

function isFieldDisabled(field: { conditions?: Condition[] }, values: Record<string, unknown>): boolean {
  if (!field.conditions?.length) return false
  return field.conditions
    .filter(c => c.type === 'disabled')
    .some(c => evalCondition(c, values))
}

type SchemaItem = FieldMeta | SectionMeta | TabsMeta

function flattenFormFields(schema: SchemaItem[]): FieldMeta[] {
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
  const formFields = flattenFormFields(schema)

  const initialValues = Object.fromEntries(
    formFields.map((f) => [f.name, (record as Record<string, unknown>)?.[f.name] ?? ''])
  )

  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

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

  function renderField(field: FieldMeta) {
    if (!isFieldVisible(field as { conditions?: Condition[] }, values)) return null
    const fieldDisabled = isFieldDisabled(field as { conditions?: Condition[] }, values)
    return (
      <div key={field.name}>
        {field.type !== 'boolean' && field.type !== 'toggle' && field.type !== 'hidden' && (
          <label className="block text-sm font-medium mb-1.5">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </label>
        )}
        <FieldInput field={field} value={values[field.name]} onChange={(v: unknown) => setValue(field.name, v)} uploadBase={uploadBase} i18n={i18n} disabled={fieldDisabled} />
        {errors[field.name]?.map((e) => (
          <p key={e} className="mt-1 text-xs text-destructive">{e}</p>
        ))}
      </div>
    )
  }

  function renderSchemaItem(item: SchemaItem, index: number) {
    if (item.type === 'section') {
      const section = item as SectionMeta
      const key     = `section-${index}`
      const fields  = section.fields.filter((f) => isFieldVisible(f as { conditions?: Condition[] }, values))
      if (fields.length === 0) return null
      const open    = section.collapsible ? !(collapsedSections[key] ?? section.collapsed) : true

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

    if (item.type === 'tabs') {
      const tabsMeta = item as TabsMeta
      const key = `tabs-${index}`
      return (
        <Tabs key={key} defaultValue={tabsMeta.tabs[0]?.label} className="rounded-xl border border-border bg-card">
          <TabsList className="w-full justify-start rounded-none border-b bg-muted/40 px-2">
            {tabsMeta.tabs.map((tab) => (
              <TabsTrigger key={tab.label} value={tab.label} className="text-sm">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabsMeta.tabs.map((tab) => (
            <TabsContent key={tab.label} value={tab.label} className="p-5 flex flex-col gap-4 mt-0">
              {tab.fields
                .filter((f) => isFieldVisible(f as { conditions?: Condition[] }, values))
                .map((f) => renderField(f))
              }
            </TabsContent>
          ))}
        </Tabs>
      )
    }

    return renderField(item as FieldMeta)
  }

  return (
    <>
      <Breadcrumbs crumbs={[
        { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}` },
        { label: globalMeta.label },
      ]} />

      <div className="max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {schema.map((item, i) => renderSchemaItem(item, i))}
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
