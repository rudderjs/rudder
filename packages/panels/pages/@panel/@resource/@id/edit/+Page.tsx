'use client'

import { useState, useEffect, useRef } from 'react'
import { useData }   from 'vike-react/useData'
import { navigate }  from 'vike/client/router'
import { useConfig } from 'vike-react/useConfig'
import { Breadcrumbs }      from '../../../../_components/Breadcrumbs.js'
import { EditToolbar }      from '../../../../_components/edit/EditToolbar.js'
import { FormActions }      from '../../../../_components/edit/FormActions.js'
import { SchemaRenderer }   from '../../../../_components/edit/SchemaRenderer.js'
import { VersionHistory }   from '../../../../_components/edit/VersionHistory.js'
import { useCollaborativeForm } from '../../../../_hooks/useCollaborativeForm.js'
import { useEditForm }      from '../../../../_hooks/useEditForm.js'
import { flattenFormFields, buildInitialValues } from '../../../../_lib/formHelpers.js'
import type { SchemaItem }  from '../../../../_lib/formHelpers.js'
import type { Data } from './+data.js'

export default function EditPage() {
  const config = useConfig()
  const {
    panelMeta, resourceMeta, record,
    pathSegment, slug, id,
    versioned, draftable, collaborative,
    wsLivePath, docName, liveProviders,
  } = useData<Data>()

  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = panelMeta.i18n as Data['panelMeta']['i18n'] & Record<string, string>
  config({ title: `${i18n.edit} ${resourceMeta.labelSingular} — ${panelName}` })

  // ── Back navigation ──────────────────────────────────────
  const defaultBack = `/${pathSegment}/${slug}`
  const [backHref, setBackHref] = useState(defaultBack)
  useEffect(() => {
    const fromQs = new URLSearchParams(window.location.search).get('back')
    if (fromQs) setBackHref(fromQs)
  }, [])

  if (!record) {
    return <p className="text-muted-foreground">{i18n.recordNotFound}</p>
  }

  // ── Schema + fields ──────────────────────────────────────
  const schema     = resourceMeta.fields as SchemaItem[]
  const formFields = flattenFormFields(schema, 'edit')
  const uploadBase = `/${pathSegment}/api`

  // Text-based collaborative fields each get their own Y.Doc (via Lexical).
  // Only non-text collaborative fields (toggles, selects) use the shared Y.Map.
  const textTypes = new Set(['text', 'textarea', 'email', 'richcontent', 'content'])

  const collabFields = formFields.map((f) => ({
    name: f.name,
    collaborative: f.collaborative && !textTypes.has(f.type) ? true : false,
    textField: false, // no more Y.Text in shared doc — all text fields self-sync via Lexical
  }))

  // All text-based collaborative fields self-sync — don't double-write via setCollaborativeValue
  const selfSyncFields = new Set(
    formFields
      .filter(f => f.collaborative && textTypes.has(f.type))
      .map(f => f.name)
  )

  const initialValues = buildInitialValues(formFields, record as Record<string, unknown>)

  // ── Collaborative form ───────────────────────────────────
  // formKey lives here (not in useEditForm) so useCollaborativeForm can use it as resetKey.
  const [formKey, setFormKey] = useState(0)

  // Ref for current form values — useCollaborativeForm seeds from this on reconnect.
  const currentValuesRef = useRef<Record<string, unknown>>(initialValues)

  // Flag to skip broadcast handler when we're the one who triggered _sync-live
  const isSyncingRef = useRef(false)

  // Ref bridges useCollaborativeForm (called first) → useEditForm's setFormValue (called second).
  const remoteSetValueRef = useRef<(name: string, value: unknown) => void>(() => {})

  const {
    connected, synced, presences,
    setCollaborativeValue, syncAllFieldsToDoc,
    getDoc, awareness, userName, userColor,
  } = useCollaborativeForm(
    collaborative && docName && wsLivePath
      ? { docName: docName!, wsPath: wsLivePath!, fields: collabFields, values: initialValues, getValues: () => currentValuesRef.current, setValue: (name, value) => remoteSetValueRef.current(name, value), providers: liveProviders as any }
      : null,
  )

  // ── Edit form state ──────────────────────────────────────
  const {
    values, errors, saving, activeVersionId, isRestorePreview,
    setValue, setFormValue, resetForm, rejoinLive, handleSave, handleSubmit, restoreVersion,
  } = useEditForm({
    pathSegment, slug, id, initialValues, backHref,
    versioned, draftable, collaborative, i18n,
    syncAllFieldsToDoc: collaborative ? syncAllFieldsToDoc : undefined,
    setCollaborativeValue: collaborative ? setCollaborativeValue : undefined,
    selfSyncFields,
    setFormKey,
    formKey,
    isSyncingRef,
  })

  // Keep refs in sync with latest state.
  // During restore preview, remote Y.Map changes are ignored (form is non-collaborative).
  remoteSetValueRef.current = isRestorePreview ? () => {} : setFormValue
  currentValuesRef.current = values

  // ── Listen for remote version restore (another user restored) ──
  useEffect(() => {
    if (!collaborative || typeof window === 'undefined') return
    let destroyed = false
    let socket: any = null

    async function connect() {
      try {
        const mod = await import(/* @vite-ignore */ '/src/BKSocket.ts') as any
        if (destroyed) return
        socket = new mod.BKSocket(`ws://${window.location.host}/ws`)
        socket.channel(`panel:${slug}`).on('version.restored', async (data: any) => {
          if (data?.id !== id) return
          if (isSyncingRef.current) return
          // Another user saved after restoring a version.
          // 1. Unmount editors (stop stale Y.Doc connections)
          setFormKey(-1)
          await new Promise(r => setTimeout(r, 300))
          // 2. Fetch fresh record from DB
          try {
            const res = await fetch(`/${pathSegment}/api/${slug}/${id}`)
            if (res.ok) {
              const body = await res.json() as { data: Record<string, unknown> }
              const freshValues = buildInitialValues(formFields, body.data)
              // 3. Update form state with fresh DB values
              for (const [key, val] of Object.entries(freshValues)) {
                setFormValue(key, val)
              }
            }
          } catch { /* ignore */ }
          // 4. Rejoin collaborative mode — editors remount with fresh Y.Docs
          setFormKey(0)
        })
      } catch { /* BKSocket not available */ }
    }

    void connect()
    return () => {
      destroyed = true
      socket?.disconnect()
    }
  }, [collaborative, slug, id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Version history toggle ───────────────────────────────
  const [showHistory, setShowHistory] = useState(false)

  const recordStatus = draftable
    ? ((record as Record<string, unknown>)?.['draftStatus'] as string ?? 'draft')
    : null

  // ── Render ───────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs crumbs={[
        { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}/${slug}` },
        { label: resourceMeta.label, href: `/${pathSegment}/${slug}` },
        { label: `${i18n.edit} ${resourceMeta.labelSingular}` },
      ]} />

      <EditToolbar
        collaborative={collaborative}
        versioned={versioned}
        draftable={draftable}
        connected={connected}
        presences={presences}
        recordStatus={recordStatus}
        showHistory={showHistory}
        onToggleHistory={() => setShowHistory(!showHistory)}
        i18n={i18n}
      />

      <div className={versioned && showHistory ? 'flex gap-6' : ''}>
        <div className={versioned && showHistory ? 'flex-1 max-w-2xl' : 'max-w-2xl'}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <SchemaRenderer
              key={formKey}
              schema={schema}
              values={values}
              errors={errors}
              setValue={setValue}
              uploadBase={uploadBase}
              i18n={i18n}
              mode="edit"
              awareness={awareness}
              getDoc={getDoc}
              synced={synced}
              userName={userName}
              userColor={userColor}
              wsPath={formKey === 0 ? wsLivePath : null}
              docName={formKey === 0 ? docName : null}
            />
            <FormActions
              draftable={draftable}
              recordStatus={recordStatus}
              saving={saving}
              backHref={backHref}
              onPublish={() => void handleSave('publish')}
              onUnpublish={() => void handleSave('unpublish')}
              i18n={i18n}
            />
          </form>
        </div>

        {versioned && showHistory && (
          <VersionHistory
            pathSegment={pathSegment}
            slug={slug}
            id={id}
            onRestore={restoreVersion}
            onRejoinLive={rejoinLive}
            i18n={i18n}
            activeVersionId={activeVersionId}
            isRestorePreview={isRestorePreview}
          />
        )}
      </div>
    </>
  )
}
