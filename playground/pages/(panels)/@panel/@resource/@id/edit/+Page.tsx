'use client'

import { useState, useEffect } from 'react'
import { useData }   from 'vike-react/useData'
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

  const collabFields = formFields.map((f) => ({
    name: f.name,
    collaborative: (f.type === 'content' || f.type === 'richcontent') ? false : (f.collaborative ?? false),
    textField: f.collaborative && (f.type === 'text' || f.type === 'textarea' || f.type === 'email'),
  }))

  // Fields that handle their own Y.Doc sync — don't double-write via setCollaborativeValue:
  // - text/textarea/email with .collaborative() → sync via useYTextSync (Y.Text delta)
  // - richcontent/content with .collaborative() → sync via CollaborationPlugin (Y.XmlFragment)
  const selfSyncFields = new Set(
    formFields
      .filter(f => f.collaborative && (
        f.type === 'text' || f.type === 'textarea' || f.type === 'email' ||
        f.type === 'richcontent' || f.type === 'content'
      ))
      .map(f => f.name)
  )

  const initialValues = buildInitialValues(formFields, record as Record<string, unknown>)

  // ── Collaborative form ───────────────────────────────────
  const {
    connected, synced, presences,
    setCollaborativeValue, syncAllFieldsToDoc,
    getYText, getDoc, awareness, userName, userColor,
  } = useCollaborativeForm(
    collaborative && docName && wsLivePath
      ? { docName, wsPath: wsLivePath, fields: collabFields, values: initialValues, setValue: () => {}, providers: liveProviders as any }
      : null,
  )

  // ── Edit form state ──────────────────────────────────────
  const {
    values, errors, saving,
    setValue, handleSave, handleSubmit, restoreVersion,
  } = useEditForm({
    pathSegment, slug, id, initialValues, backHref,
    versioned, draftable, collaborative, i18n,
    syncAllFieldsToDoc: collaborative ? syncAllFieldsToDoc : undefined,
    setCollaborativeValue: collaborative ? setCollaborativeValue : undefined,
    selfSyncFields,
  })

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
              schema={schema}
              values={values}
              errors={errors}
              setValue={setValue}
              uploadBase={uploadBase}
              i18n={i18n}
              mode="edit"
              getYText={getYText}
              awareness={awareness}
              getDoc={getDoc}
              synced={synced}
              userName={userName}
              userColor={userColor}
              wsPath={wsLivePath}
              docName={docName}
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
            i18n={i18n}
          />
        )}
      </div>
    </>
  )
}
