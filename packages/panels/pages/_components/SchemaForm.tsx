'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { SchemaFormMeta, PanelI18n, FieldMeta } from '@boostkit/panels'
import { FieldInput } from './FieldInput.js'
import { SchemaRenderer } from './edit/SchemaRenderer.js'
import { EditToolbar } from './edit/EditToolbar.js'
import { FormActions } from './edit/FormActions.js'
import { VersionHistory } from './edit/VersionHistory.js'
import { useAutosave } from '../_hooks/useAutosave.js'
import { useFormPersist } from '../_hooks/useFormPersist.js'
import { useFieldPersist } from '../_hooks/useFieldPersist.js'
import { flattenFormFields } from '../_lib/formHelpers.js'
import type { SchemaItem } from '../_lib/formHelpers.js'

interface SchemaFormProps {
  form:       SchemaFormMeta
  panelPath:  string
  i18n:       PanelI18n
  /** Called after successful submit. Return a URL string to navigate there. */
  onSuccess?: (data: unknown) => string | void
  /** Custom submit URL (overrides form.action). */
  submitUrl?: string
  /** Custom submit method (overrides form.method). */
  submitMethod?: string
  /** Pre-populate form values (merged with form initialValues). */
  prefill?: Record<string, unknown>
  /** Mode: 'create' or 'edit' — controls which fields are hidden. Default: 'create'. */
  mode?: 'create' | 'edit'
  /** Cancel URL — shows a cancel link next to submit. */
  cancelUrl?: string
  /** Record ID — enables edit mode (autosave, versioning, draft workflow). */
  recordId?: string
  /** Resource slug — for API endpoints in edit mode. */
  resourceSlug?: string
  /** Back navigation URL after save. */
  backUrl?: string
}

// Text-based field types that get per-field Y.Doc (not shared Y.Map)
const TEXT_TYPES = new Set(['text', 'textarea', 'email', 'richcontent', 'content'])

export function SchemaForm({ form, panelPath, i18n, onSuccess, submitUrl, submitMethod, prefill, mode = 'create', cancelUrl, recordId, resourceSlug, backUrl }: SchemaFormProps) {
  const pathSegment = panelPath.replace(/^\//, '')
  const isStandalone = (form as SchemaFormMeta & { standalone?: boolean }).standalone === true
  const rawFormYjs = form as SchemaFormMeta & { yjs?: boolean; wsLivePath?: string | null; docName?: string | null; liveProviders?: string[] }

  const formYjs = rawFormYjs

  // Build a map of field persist modes for quick lookup
  const fieldPersistModes = new Map<string, string>()
  for (const item of form.fields) {
    const field = item as FieldMeta
    if (field.name && field.persist) {
      fieldPersistModes.set(field.name, typeof field.persist === 'string' ? field.persist : 'yjs')
    }
  }

  // Build dependency map: when field X changes, recompute fields Y, Z
  const computeDeps = new Map<string, Array<{ fieldName: string; from: string[]; debounce: number }>>()
  for (const item of form.fields) {
    const field = item as FieldMeta & { debounce?: number }
    if (field.name && field.from && field.from.length > 0) {
      for (const dep of field.from) {
        const list = computeDeps.get(dep) ?? []
        list.push({ fieldName: field.name, from: field.from, debounce: field.debounce ?? 200 })
        computeDeps.set(dep, list)
      }
    }
  }
  const computeTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

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
      for (const [fieldName, persistMode] of fieldPersistModes) {
        if (persistMode === 'localStorage') {
          try {
            const stored = localStorage.getItem(`form:${form.id}:${fieldName}`)
            if (stored !== null) result[fieldName] = JSON.parse(stored)
          } catch { /* ignore */ }
        }
        if (persistMode === 'url') {
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

    // 4. Prefill values (from URL params or explicit prop)
    if (prefill) Object.assign(result, prefill)

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

    // Flatten Section/Tabs to find all collaborative fields
    const mapFields: string[] = []
    const textFieldNames: string[] = []
    function collectCollabFields(items: unknown[]) {
      for (const item of items) {
        const f = item as FieldMeta & { type: string; fields?: unknown[] }
        if (f.type === 'section' || f.type === 'tabs') {
          if (f.fields) collectCollabFields(f.fields)
          if (f.type === 'tabs' && (f as any).tabs) {
            for (const tab of (f as any).tabs) {
              if (tab.fields) collectCollabFields(tab.fields)
            }
          }
        } else if (f.name && f.yjs && !TEXT_TYPES.has(f.type)) {
          mapFields.push(f.name)
        } else if (f.name && f.yjs && TEXT_TYPES.has(f.type)) {
          textFieldNames.push(f.name)
        }
      }
    }
    collectCollabFields(form.fields)
    // Even if no map fields, still set up WebSocket for connection status tracking
    if (mapFields.length === 0 && textFieldNames.length === 0 && !needsWebsocket) return

    let destroyed = false

    ;(async () => {
      const Y = await import('yjs')
      if (destroyed) return

      const doc = new Y.Doc()
      const fieldsMap = doc.getMap('fields')
      const suppress = new Set<string>()

      const mapFieldSet = new Set(mapFields)
      const textFieldSet = new Set(textFieldNames)
      fieldsMap.observe((event: unknown) => {
        const mapEvent = event as { keysChanged: Set<string> }
        mapEvent.keysChanged.forEach((key: string) => {
          if (suppress.has(key)) return
          if (mapFieldSet.has(key)) {
            // Non-text collaborative field — update React state directly
            setValues(prev => ({ ...prev, [key]: fieldsMap.get(key) }))
          } else if (textFieldSet.has(key)) {
            // Text-type collaborative field — updated by AI agent via Y.Map.
            // Push through the imperative editor ref so the Lexical/collab binding picks it up.
            const val = fieldsMap.get(key)
            setValues(prev => ({ ...prev, [key]: val }))
            // Also update the collaborative editor if mounted
            void updateTextFieldRef(key, val)
          }
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

      if (needsIndexeddb) {
        const { IndexeddbPersistence } = await import('y-indexeddb')
        if (destroyed) return
        idbProvider = new IndexeddbPersistence(formYjs.docName!, doc)
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

      if (!needsWebsocket && needsIndexeddb) {
        seedAfterSync()
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

  // Ref to track latest values for compute without state updater
  const valuesRef = useRef(values)
  valuesRef.current = values

  function handleChange(name: string, value: unknown) {
    const next = { ...valuesRef.current, [name]: value }
    valuesRef.current = next
    setValues(next)

    // Trigger recomputation for dependent fields (debounced)
    const dependents = computeDeps.get(name)
    if (dependents && dependents.length > 0) {
      for (const dep of dependents) {
        const existing = computeTimerRef.current.get(dep.fieldName)
        if (existing) clearTimeout(existing)

        const doCompute = () => {
          const depValues: Record<string, unknown> = {}
          const current = valuesRef.current
          for (const f of dep.from) depValues[f] = current[f]

          fetch(`/${pathSegment}/api/_forms/${form.id}/compute/${dep.fieldName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(depValues),
          })
            .then(r => r.ok ? r.json() : null)
            .then((body: { value?: unknown } | null) => {
              if (body?.value !== undefined) {
                valuesRef.current = { ...valuesRef.current, [dep.fieldName]: body.value }
                setValues(valuesRef.current)
              }
            })
            .catch(() => {})
        }

        if (dep.debounce <= 0) {
          doCompute()
        } else {
          const timer = setTimeout(doCompute, dep.debounce)
          computeTimerRef.current.set(dep.fieldName, timer)
        }
      }
    }
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

  // ── Edit-mode features (autosave, versioning, draft) ──────
  const formMeta = form as SchemaFormMeta & { autosave?: boolean; autosaveInterval?: number; versioned?: boolean; draftable?: boolean }
  const isEditMode = !!recordId && !!resourceSlug
  const autosaveEnabled = isEditMode && !!formMeta.autosave
  const versionedEnabled = isEditMode && !!formMeta.versioned
  const draftableEnabled = isEditMode && !!formMeta.draftable
  const effectiveBackUrl = backUrl ?? cancelUrl ?? panelPath

  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // ── Edit-mode save handler ──────────────────────────────
  async function handleEditSave(publishAction?: 'draft' | 'publish' | 'unpublish') {
    if (!isEditMode) return
    setSaving(true)
    setFieldErrors({})
    try {
      const payload = { ...values } as Record<string, unknown>
      if (draftableEnabled && publishAction) {
        payload['draftStatus'] = publishAction === 'publish' ? 'published' : 'draft'
      }
      const res = await fetch(`/${pathSegment}/api/${resourceSlug}/${recordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.status === 422) {
        const body = await res.json() as { errors: Record<string, string | string[]> }
        const flat: Record<string, string> = {}
        for (const [k, v] of Object.entries(body.errors)) flat[k] = Array.isArray(v) ? v[0] ?? '' : v
        setFieldErrors(flat)
        return
      }
      if (!res.ok) {
        const { toast } = await import('sonner')
        toast.error((i18n as Record<string, string>).saveError ?? 'Save failed.')
        return
      }
      // Create version snapshot
      if (versionedEnabled) {
        await fetch(`/${pathSegment}/api/${resourceSlug}/${recordId}/_versions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: null, fields: values }),
        })
      }
      // Toast + navigate
      const { toast } = await import('sonner')
      if (draftableEnabled && publishAction === 'publish') toast.success((i18n as Record<string, string>).publishedToastDraft ?? 'Published.')
      else if (draftableEnabled && publishAction === 'unpublish') toast.success((i18n as Record<string, string>).unpublishedToast ?? 'Unpublished.')
      else toast.success((i18n as Record<string, string>).savedToast ?? 'Saved.')

      // Disconnect Yjs providers before navigating away.
      // Y.Doc rooms retain their content — they match the DB after save.
      if (formYjs.yjs && resourceSlug && recordId) {
        collabRef.current?.provider?.destroy()
        collabRef.current?.idb?.destroy()
      }

      autosaveResetBaseline?.()
      const { navigate } = await import('vike/client/router')
      void navigate(effectiveBackUrl)
    } catch {
      const { toast } = await import('sonner')
      toast.error((i18n as Record<string, string>).saveError ?? 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  // ── Update collaborative text field via imperative ref ────
  /** Push a value into a collaborative text/richcontent editor.
   * Works for AI agent updates (via Y.Map observer) and version restore. */
  async function updateTextFieldRef(name: string, value: unknown) {
    const field = form.fields.find(f => (f as FieldMeta).name === name) as FieldMeta | undefined
    if (!field?.yjs || !TEXT_TYPES.has(field.type)) return

    if (field.type === 'richcontent' || field.type === 'content') {
      import('./fields/RichContentInput.js').then(({ getRichContentRef }) => {
        const ref = getRichContentRef(name)
        if (ref) ref.setContent(value)
      }).catch(() => {})
    } else {
      // text, textarea, email — use collab text ref
      import('./fields/TextInput.js').then(({ getCollabTextRef }) => {
        const ref = getCollabTextRef(name)
        if (ref) {
          ref.setContent(String(value ?? ''))
        } else {
          import('./fields/TextareaInput.js').then(({ getCollabTextareaRef }) => {
            const ref2 = getCollabTextareaRef(name)
            if (ref2) ref2.setContent(String(value ?? ''))
          }).catch(() => {})
        }
      }).catch(() => {})
    }
  }

  // ── Version restore ──────────────────────────────────────
  /** Restore a single field from a version — updates the live form value.
   * For richcontent fields, writes directly to the editor via imperative ref,
   * which propagates through the CollaborationPlugin to all connected users. */
  function restoreField(name: string, value: unknown) {
    handleChange(name, value)

    // Sync to Y.Map for all collab fields
    if (collabRef.current?.fieldsMap) {
      collabRef.current.suppress.add(name)
      collabRef.current.fieldsMap.set(name, value)
      setTimeout(() => collabRef.current?.suppress.delete(name), 50)
    }

    void updateTextFieldRef(name, value)
  }

  /** Restore all changed fields from a version */
  function restoreAllFields(fieldValues: Record<string, unknown>) {
    for (const [name, value] of Object.entries(fieldValues)) {
      restoreField(name, value)
    }
  }

  // ── Autosave ──────────────────────────────────────────────
  const { autosaveStatus, autosaveDirty, resetBaseline: autosaveResetBaseline } = useAutosave({
    enabled: autosaveEnabled,
    interval: formMeta.autosaveInterval ?? 30000,
    endpoint: isEditMode ? `/${pathSegment}/api/${resourceSlug}/${recordId}` : '',
    values,
    initialValues: (form as { initialValues?: Record<string, unknown> }).initialValues ?? {},
    saving,
    yjs: !!formYjs.yjs,
    syncAllFieldsToDoc: formYjs.yjs && collabRef.current?.fieldsMap ? (vals) => {
      const doc = collabRef.current
      if (!doc) return
      doc.doc.transact(() => {
        for (const [k, v] of Object.entries(vals)) doc.fieldsMap.set(k, v)
      })
    } : undefined,
  })

  // ── Per-field persist (edit mode) ─────────────────────────
  const editFormFields = isEditMode ? flattenFormFields(form.fields as SchemaItem[], 'edit') : []
  const fieldPersistKey = isEditMode ? `bk:${pathSegment}:${resourceSlug}:${recordId}:edit` : ''
  const { clearPersistedFields } = useFieldPersist({
    storageKeyPrefix: fieldPersistKey,
    formFields: editFormFields,
    values,
    setValue: (name: string, value: unknown) => handleChange(name, value),
  })

  // ── Draft recovery (edit mode) ────────────────────────────
  const draftRecoveryKey = isEditMode ? `bk:${pathSegment}:${resourceSlug}:${recordId}:edit` : ''
  const persistOps = useFormPersist({
    storageKey: draftRecoveryKey,
    enabled: false, // draft recovery controlled by resource, not form
    values,
    initialValues: (form as { initialValues?: Record<string, unknown> }).initialValues ?? {},
    onRestore: (restored) => {
      for (const [key, val] of Object.entries(restored)) handleChange(key, val)
    },
  })

  // Record status for draft badge
  const recordStatus = draftableEnabled
    ? (String(values['draftStatus'] ?? 'draft'))
    : null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // In edit mode, delegate to edit save handler
    if (isEditMode) {
      if (draftableEnabled) {
        await handleEditSave('draft')
      } else {
        await handleEditSave()
      }
      return
    }
    setSubmitting(true)
    setServerError(null)
    const apiBase = panelPath.replace(/\/$/, '') + '/api'
    const effectiveUrl = submitUrl ?? (form as { action?: string }).action ?? `${apiBase}/_forms/${form.id}/submit`
    const effectiveMethod = submitMethod ?? (form as { method?: string }).method ?? 'POST'
    try {
      const res = await fetch(effectiveUrl, { method: effectiveMethod, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) })
      if (res.ok) {
        const responseData = await res.json().catch(() => ({}))
        // Navigation/toast via onSuccess callback
        if (onSuccess) {
          const navigateTo = onSuccess(responseData)
          if (typeof navigateTo === 'string') {
            const { navigate } = await import('vike/client/router')
            void navigate(navigateTo)
            return
          }
          // onSuccess handled it (e.g. toast) — don't show inline success message
          return
        }
        setSubmitted(true)
      } else {
        const body = await res.json() as { message?: string; errors?: Record<string, string | string[]> }
        if (body.errors) {
          const flat: Record<string, string> = {}
          for (const [k, v] of Object.entries(body.errors)) {
            flat[k] = Array.isArray(v) ? v[0] ?? '' : v
          }
          setFieldErrors(flat)
        }
        else setServerError(body.message ?? 'Submission failed.')
      }
    } catch {
      setServerError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isStandalone && submitted) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{form.successMessage ?? 'Submitted successfully.'}</p>
        <div>
          <button
            type="button"
            onClick={() => { setSubmitted(false); setValues(() => {
              const result: Record<string, unknown> = {}
              for (const item of form.fields) {
                const field = item as FieldMeta
                if (field.name && field.defaultValue !== undefined) result[field.name] = field.defaultValue
              }
              return result
            }) }}
            className="text-sm text-primary hover:underline"
          >
            {i18n.submitAnother ?? 'Submit another'}
          </button>
        </div>
      </div>
    )
  }

  // Common renderer props
  const rendererProps = {
    schema: form.fields as SchemaItem[],
    values,
    errors: Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, [v]])) as Record<string, string[]>,
    setValue: (name: string, value: unknown) => handleChange(name, value),
    uploadBase: panelPath.replace(/\/$/, '') + '/api',
    i18n: i18n as PanelI18n & Record<string, string>,
    mode,
    ...(formYjs.yjs && formYjs.wsLivePath ? { wsPath: formYjs.wsLivePath } : {}),
    ...(formYjs.yjs && formYjs.docName ? { docName: formYjs.docName } : {}),
    ...(userName ? { userName } : {}),
    ...(userColor ? { userColor } : {}),
  }

  return (
    <div>
      {(form as { description?: string }).description && (
        <p className="text-sm text-muted-foreground mb-4">{(form as { description?: string }).description}</p>
      )}

      {/* Edit mode: toolbar (collab status, draft badge, autosave, version history toggle) */}
      {isEditMode && (versionedEnabled || draftableEnabled || autosaveEnabled || formYjs.yjs) && (
        <EditToolbar
          yjs={!!formYjs.yjs}
          versioned={versionedEnabled}
          draftable={draftableEnabled}
          connected={collabConnected}
          presences={collabPresences}
          recordStatus={recordStatus}
          showHistory={showHistory}
          onToggleHistory={() => setShowHistory(!showHistory)}
          i18n={i18n as PanelI18n & Record<string, string>}
          autosave={autosaveEnabled}
          autosaveStatus={autosaveStatus}
          autosaveDirty={autosaveDirty}
        />
      )}

      {/* Standalone collab indicator (non-edit mode) */}
      {!isEditMode && formYjs.yjs && form.fields.some(f => {
        const field = f as FieldMeta
        return field.yjs && !TEXT_TYPES.has(field.type)
      }) && (
        <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
          <span className={`w-2 h-2 rounded-full ${collabConnected ? 'bg-green-500' : 'bg-red-400'}`} />
          <span>{collabConnected ? i18n.connectedLive ?? 'Connected' : i18n.disconnectedLive ?? 'Disconnected'}</span>
          {collabPresences.length > 1 && (
            <span className="ml-2">{(i18n.editingNow ?? ':n editing').replace(':n', String(collabPresences.length))}</span>
          )}
        </div>
      )}

      {/* Layout: form + optional version history sidebar */}
      <div className={versionedEnabled && showHistory ? 'flex gap-6' : ''}>
        <div className={versionedEnabled && showHistory ? 'flex-1 max-w-2xl' : ''}>
          {isStandalone ? (
            <div className="flex flex-col gap-4">
              <SchemaRenderer key="form" {...rendererProps} />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <SchemaRenderer key="form" {...rendererProps} />
              {serverError && <p className="text-sm text-destructive">{serverError}</p>}

              {/* Edit mode: FormActions (save/publish/unpublish/cancel) */}
              {isEditMode ? (
                <FormActions
                  draftable={draftableEnabled}
                  recordStatus={recordStatus}
                  saving={saving}
                  backHref={effectiveBackUrl}
                  onPublish={() => void handleEditSave('publish')}
                  onUnpublish={() => void handleEditSave('unpublish')}
                  i18n={i18n as PanelI18n & Record<string, string>}
                />
              ) : (
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={submitting}
                    className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                  >
                    {submitting ? '...' : (form.submitLabel ?? i18n.save ?? 'Submit')}
                  </button>
                  {cancelUrl && (
                    <a href={cancelUrl} className="px-5 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {i18n.cancel ?? 'Cancel'}
                    </a>
                  )}
                </div>
              )}
            </form>
          )}
        </div>

        {/* Version history sidebar */}
        {isEditMode && versionedEnabled && showHistory && (
          <VersionHistory
            pathSegment={pathSegment}
            slug={resourceSlug!}
            id={recordId!}
            values={values}
            fields={form.fields as FieldMeta[]}
            onRestoreField={restoreField}
            onRestoreAll={restoreAllFields}
            i18n={i18n as PanelI18n & Record<string, string>}
          />
        )}
      </div>
    </div>
  )
}
