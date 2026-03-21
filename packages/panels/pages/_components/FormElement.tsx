'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { FormElementMeta, PanelI18n, FieldMeta } from '@boostkit/panels'
import { FieldInput } from './FieldInput.js'

interface FormElementProps {
  form:       FormElementMeta
  panelPath:  string
  i18n:       PanelI18n
}

// Text-based field types that get per-field Y.Doc (not shared Y.Map)
const TEXT_TYPES = new Set(['text', 'textarea', 'email', 'richcontent', 'content'])

export function FormElement({ form, panelPath, i18n }: FormElementProps) {
  const pathSegment = panelPath.replace(/^\//, '')
  const formYjs = form as FormElementMeta & { yjs?: boolean; wsLivePath?: string | null; docName?: string | null; liveProviders?: string[] }

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
        if (mode === 'url') {
          const url = new URL(window.location.href)
          const urlKey = `${form.id}_${fieldName}`
          const urlValue = url.searchParams.get(urlKey)
          if (urlValue !== null) result[fieldName] = urlValue
        }
      }
    }

    // 3. SSR initialValues override everything
    const initial = (form as { initialValues?: Record<string, unknown> }).initialValues
    if (initial) Object.assign(result, initial)

    return result
  })
  const [submitting,   setSubmitting]   = useState(false)
  const [submitted,    setSubmitted]    = useState(false)
  const [serverError,  setServerError]  = useState<string | null>(null)
  const [fieldErrors,  setFieldErrors]  = useState<Record<string, string>>({})

  // ── Collaborative editing (Yjs) ──────────────────────────
  const [collabConnected, setCollabConnected] = useState(false)
  const [collabPresences, setCollabPresences] = useState<Array<{ name: string; color: string }>>([])
  const [userName] = useState(() => typeof window === 'undefined' ? 'User' : `User-${Math.floor(Math.random() * 1000)}`)
  const [userColor] = useState(() => typeof window === 'undefined' ? '#3b82f6' : `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`)

  const collabRef = useRef<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any; provider: any; idb: any; fieldsMap: any; suppress: Set<string>
  } | null>(null)

  // Set up Yjs for non-text collaborative fields
  useEffect(() => {
    if (!formYjs.yjs || !formYjs.docName) return
    const needsWebsocket = formYjs.liveProviders?.includes('websocket') ?? false
    const needsIndexeddb = formYjs.liveProviders?.includes('indexeddb') ?? false
    if (!needsWebsocket && !needsIndexeddb) return

    const mapFields: string[] = []
    for (const item of form.fields) {
      const field = item as FieldMeta
      if (field.name && field.yjs && !TEXT_TYPES.has(field.type)) {
        mapFields.push(field.name)
      }
    }
    if (mapFields.length === 0) return

    let destroyed = false

    ;(async () => {
      const Y = await import('yjs')
      if (destroyed) return

      const doc = new Y.Doc()
      const fieldsMap = doc.getMap('fields')
      const suppress = new Set<string>()

      fieldsMap.observe((event: unknown) => {
        const mapEvent = event as { keysChanged: Set<string> }
        mapEvent.keysChanged.forEach((key: string) => {
          if (!suppress.has(key)) setValues(prev => ({ ...prev, [key]: fieldsMap.get(key) }))
        })
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let wsProvider: any = null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let idbProvider: any = null

      function seedAfterSync() {
        doc.transact(() => {
          for (const name of mapFields) {
            if (!fieldsMap.has(name)) fieldsMap.set(name, values[name] ?? null)
          }
        })
      }

      if (needsWebsocket && formYjs.wsLivePath) {
        const { WebsocketProvider } = await import('y-websocket')
        if (destroyed) return
        const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const wsUrl = `${wsProto}://${window.location.host}${formYjs.wsLivePath}`
        wsProvider = new WebsocketProvider(wsUrl, formYjs.docName!, doc)
        wsProvider.awareness.setLocalStateField('user', { name: userName, color: userColor })
        wsProvider.on('status', ({ status }: { status: string }) => { if (!destroyed) setCollabConnected(status === 'connected') })
        wsProvider.awareness.on('change', () => {
          if (destroyed) return
          const states = [...wsProvider.awareness.getStates().values()]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setCollabPresences(states.flatMap((s: any) => s.user ? [s.user] : []))
        })
        wsProvider.once('synced', () => { if (!destroyed) seedAfterSync() })
      }

      if (needsIndexeddb) {
        const { IndexeddbPersistence } = await import('y-indexeddb')
        if (destroyed) return
        idbProvider = new IndexeddbPersistence(formYjs.docName!, doc)
        if (!needsWebsocket) idbProvider.once('synced', () => { if (!destroyed) seedAfterSync() })
      }

      collabRef.current = { doc, provider: wsProvider, idb: idbProvider, fieldsMap, suppress }
    })()

    return () => {
      destroyed = true
      collabRef.current?.provider?.destroy()
      collabRef.current?.idb?.destroy()
      collabRef.current?.doc?.destroy()
      collabRef.current = null
      setCollabConnected(false)
      setCollabPresences([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formYjs.yjs, formYjs.docName])

  // Restore localStorage after hydration
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
    if (Object.keys(restored).length > 0) setValues(prev => ({ ...prev, ...restored }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist a field value
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
      }).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id, pathSegment])

  function handleChange(name: string, value: unknown) {
    setValues(prev => ({ ...prev, [name]: value }))
    setFieldErrors(prev => { const n = { ...prev }; delete n[name]; return n })
    persistFieldValue(name, value)

    // Sync to Y.Map for collaborative non-text fields
    if (collabRef.current?.fieldsMap) {
      const field = form.fields.find(f => (f as FieldMeta).name === name) as FieldMeta | undefined
      if (field?.yjs && !TEXT_TYPES.has(field.type)) {
        collabRef.current.suppress.add(name)
        collabRef.current.fieldsMap.set(name, value)
        setTimeout(() => collabRef.current?.suppress.delete(name), 50)
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setServerError(null)
    const apiBase = panelPath.replace(/\/$/, '') + '/api'
    const submitUrl = (form as { action?: string }).action ?? `${apiBase}/_forms/${form.id}/submit`
    const submitMethod = (form as { method?: string }).method ?? 'POST'
    try {
      const res = await fetch(submitUrl, { method: submitMethod, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) })
      if (res.ok) {
        setSubmitted(true)
      } else {
        const body = await res.json() as { message?: string; errors?: Record<string, string> }
        if (body.errors) setFieldErrors(body.errors)
        else setServerError(body.message ?? 'Submission failed.')
      }
    } catch {
      setServerError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">{form.successMessage ?? 'Submitted successfully.'}</p>
      </div>
    )
  }

  return (
    <div>
      {(form as { description?: string }).description && (
        <p className="text-sm text-muted-foreground mb-4">{(form as { description?: string }).description}</p>
      )}
      {formYjs.yjs && (
        <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
          <span className={`w-2 h-2 rounded-full ${collabConnected ? 'bg-green-500' : 'bg-red-400'}`} />
          <span>{collabConnected ? i18n.connectedLive ?? 'Connected' : i18n.disconnectedLive ?? 'Disconnected'}</span>
          {collabPresences.length > 1 && (
            <span className="ml-2">{(i18n.editingNow ?? ':n editing').replace(':n', String(collabPresences.length))}</span>
          )}
        </div>
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
                {...(formYjs.yjs && formYjs.wsLivePath ? { wsPath: formYjs.wsLivePath } : {})}
                {...(formYjs.yjs && formYjs.docName ? { docName: formYjs.docName } : {})}
                {...(userName ? { userName } : {})}
                {...(userColor ? { userColor } : {})}
              />
              {fieldErrors[field.name] && (
                <p className="text-xs text-destructive">{fieldErrors[field.name]}</p>
              )}
            </div>
          )
        })}
        {serverError && <p className="text-sm text-destructive">{serverError}</p>}
        <div>
          <button type="submit" disabled={submitting}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {submitting ? '...' : (form.submitLabel ?? 'Submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
