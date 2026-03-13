'use client'

import { useState, useCallback, useEffect } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { navigate } from 'vike/client/router'
import { toast } from 'sonner'
import { Breadcrumbs } from '../../../../_components/Breadcrumbs.js'
import { FieldInput } from '../../../../_components/FieldInput.js'
import { useCollaborativeForm } from '../../../../_hooks/useCollaborativeForm.js'
import type { FieldMeta, SectionMeta, TabsMeta, PanelI18n } from '@boostkit/panels'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.js'
import type { Data } from './+data.js'

function t(template: string, vars: Record<string, string | number>): string {
  return template.replace(/:([a-z]+)/g, (_, k: string) => String(vars[k] ?? `:${k}`))
}

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

interface VersionEntry {
  id: string
  label?: string
  createdAt: string
  userId?: string
}

export default function EditPage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, record, pathSegment, slug, id, versioned, wsLivePath, docName } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = panelMeta.i18n as Data['panelMeta']['i18n'] & Record<string, string>
  config({ title: `${i18n.edit} ${resourceMeta.labelSingular} — ${panelName}` })

  const defaultBack = `/${pathSegment}/${slug}`
  const [backHref, setBackHref] = useState(defaultBack)
  useEffect(() => {
    const fromQs = new URLSearchParams(window.location.search).get('back')
    if (fromQs) setBackHref(fromQs)
  }, [])

  if (!record) {
    return <p className="text-muted-foreground">{i18n.recordNotFound}</p>
  }

  const uploadBase = `/${pathSegment}/api`
  const schema     = resourceMeta.fields as SchemaItem[]
  const formFields = flattenFormFields(schema, 'edit')

  const collabFields = formFields.map((f) => ({
    name: f.name,
    collaborative: f.type === 'content' ? false : (f.collaborative ?? false),
    textField: f.collaborative && (f.type === 'text' || f.type === 'textarea' || f.type === 'email'),
  }))

  const initialValues = Object.fromEntries(
    formFields.map((f) => {
      const raw = (record as Record<string, unknown>)[f.name]
      if (f.type === 'belongsToMany') {
        // ORM returns array of related objects — extract IDs
        const arr = Array.isArray(raw) ? (raw as Array<{ id?: string }>) : []
        return [f.name, arr.map((r) => r.id ?? String(r)).filter(Boolean)]
      }
      return [f.name, raw ?? '']
    }),
  )
  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState<Record<string, number>>({})

  // Version history state
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(false)

  const setFormValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: [] }))
  }, [])

  // Collaborative form hook
  const { connected, synced, presences, setCollaborativeValue, syncAllFieldsToDoc, getYText, getDoc, awareness } = useCollaborativeForm(
    versioned && docName && wsLivePath
      ? { docName, wsPath: wsLivePath, fields: collabFields, values, setValue: setFormValue }
      : null,
  )

  function setValue(name: string, value: unknown) {
    setFormValue(name, value)
    // Sync collaborative fields to ydoc
    const field = collabFields.find((f) => f.name === name)
    if (field?.collaborative) setCollaborativeValue(name, value)
  }

  async function loadVersions() {
    setLoadingVersions(true)
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/${id}/_versions`)
      if (res.ok) {
        const data = await res.json() as VersionEntry[]
        setVersions(data)
      }
    } finally {
      setLoadingVersions(false)
    }
  }

  async function restoreVersion(versionId: string) {
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/${id}/_versions/${versionId}`)
      if (res.ok) {
        const data = await res.json() as { fields: Record<string, unknown> }
        setValues((prev) => ({ ...prev, ...data.fields }))
        toast.success(i18n.restoredToast ?? 'Version restored.')
      } else {
        toast.error(i18n.restoreError ?? 'Failed to restore version.')
      }
    } catch {
      toast.error(i18n.restoreError ?? 'Failed to restore version.')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      if (versioned) {
        // Sync all fields to ydoc before publish
        syncAllFieldsToDoc(values)
      }

      // Always save to DB via PUT
      const res = await fetch(`/${pathSegment}/api/${slug}/${id}`, {
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

      // For versioned resources, also snapshot a version
      if (versioned) {
        const vRes = await fetch(`/${pathSegment}/api/${slug}/${id}/_versions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: null }),
        })
        if (vRes.ok) {
          toast.success(i18n.publishedToast ?? 'Version published.')
        } else {
          toast.success(i18n.savedToast)
        }
      } else {
        toast.success(i18n.savedToast)
      }
      void navigate(backHref)
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
        <FieldInput field={field} value={values[field.name]} onChange={(v: unknown) => setValue(field.name, v)} uploadBase={uploadBase} i18n={i18n} disabled={fieldDisabled} yText={field.collaborative ? getYText(field.name) : null} awareness={field.collaborative ? awareness : null} yDoc={field.collaborative ? getDoc() : null} yDocSynced={synced} />
        {errors[field.name]?.map((e) => (
          <p key={e} className="mt-1 text-xs text-destructive">{e}</p>
        ))}
      </div>
    )
  }

  function renderSchemaItem(item: SchemaItem, index: number) {
    // ── Section ───────────────────────────────────────────
    if (item.type === 'section') {
      const section = item as SectionMeta
      const key     = `section-${index}`
      const fields  = section.fields.filter((f) => !f.hidden.includes('edit') && isFieldVisible(f as { conditions?: Condition[] }, values))
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

    // ── Tabs ─────────────────────────────────────────────
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
                .filter((f) => !f.hidden.includes('edit') && isFieldVisible(f as { conditions?: Condition[] }, values))
                .map((f) => renderField(f))
              }
            </TabsContent>
          ))}
        </Tabs>
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
        { label: `${i18n.edit} ${resourceMeta.labelSingular}` },
      ]} />

      {/* Presence & version history bar */}
      {versioned && (
        <div className="flex items-center gap-3 mb-4 text-sm">
          {/* Connection status */}
          <span className={`inline-flex items-center gap-1.5 ${connected ? 'text-green-600' : 'text-muted-foreground'}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-muted-foreground'}`} />
            {connected ? (i18n.connectedLive ?? 'Connected') : (i18n.disconnectedLive ?? 'Disconnected')}
          </span>

          {/* Presence avatars */}
          {presences.length > 1 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <span className="flex -space-x-1.5">
                {presences.slice(0, 5).map((p, i) => (
                  <span
                    key={i}
                    className="w-5 h-5 rounded-full border border-background text-[10px] font-medium flex items-center justify-center text-white"
                    style={{ backgroundColor: p.color }}
                    title={p.name}
                  >
                    {p.name[0]}
                  </span>
                ))}
              </span>
              {t(i18n.editingNow ?? ':n editing', { n: presences.length })}
            </span>
          )}

          <div className="flex-1" />

          {/* Version history toggle */}
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => { setShowHistory(!showHistory); if (!showHistory && versions.length === 0) void loadVersions() }}
          >
            {i18n.versionHistory ?? 'Version History'}
          </button>
        </div>
      )}

      <div className={versioned && showHistory ? 'flex gap-6' : ''}>
        <div className={versioned && showHistory ? 'flex-1 max-w-2xl' : 'max-w-2xl'}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {schema
              .filter((item) => {
                if (item.type === 'section' || item.type === 'tabs') return true
                return !(item as FieldMeta).hidden.includes('edit')
              })
              .map((item, i) => renderSchemaItem(item, i))
            }
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving
                  ? (versioned ? (i18n.publishing ?? 'Publishing\u2026') : i18n.saving)
                  : (versioned ? (i18n.publish ?? 'Publish') : i18n.save)
                }
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

        {/* Version history sidebar */}
        {versioned && showHistory && (
          <div className="w-72 shrink-0">
            <div className="rounded-xl border border-border bg-card">
              <div className="px-4 py-3 border-b border-border bg-muted/40">
                <p className="text-sm font-semibold">{i18n.versionHistory ?? 'Version History'}</p>
              </div>
              <div className="p-3 max-h-96 overflow-y-auto">
                {loadingVersions && <p className="text-sm text-muted-foreground">{i18n.loading}</p>}
                {!loadingVersions && versions.length === 0 && (
                  <p className="text-sm text-muted-foreground">{i18n.noVersions ?? 'No versions yet.'}</p>
                )}
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm">{v.label ?? new Date(v.createdAt).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => void restoreVersion(v.id)}
                    >
                      {i18n.restore ?? 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

    </>
  )
}
