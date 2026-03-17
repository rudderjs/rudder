import { useState, useCallback } from 'react'
import { navigate } from 'vike/client/router'
import { toast } from 'sonner'
import type { PanelI18n } from '@boostkit/panels'

interface UseEditFormOptions {
  pathSegment:   string
  slug:          string
  id:            string
  initialValues: Record<string, unknown>
  backHref:      string
  versioned:     boolean
  draftable:     boolean
  yjs: boolean
  i18n:          PanelI18n & Record<string, string>
  syncAllFieldsToDoc?:    ((values: Record<string, unknown>) => void) | undefined
  setCollaborativeValue?: ((name: string, value: unknown) => void) | undefined
  selfSyncFields?:        Set<string> | undefined
  setFormKey:              (fn: ((k: number) => number) | number) => void
  formKey:                 number
  isSyncingRef:            React.MutableRefObject<boolean>
  /** Called after a successful manual save (before navigation). */
  onSaved?:                (() => void) | undefined
}

export function useEditForm(opts: UseEditFormOptions) {
  const {
    pathSegment, slug, id, initialValues, backHref,
    versioned, draftable, yjs, i18n,
    syncAllFieldsToDoc, setCollaborativeValue, selfSyncFields, setFormKey, formKey, isSyncingRef, onSaved,
  } = opts

  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null)

  const isRestorePreview = formKey !== 0

  /** Reset form with new values and enter restore preview mode. */
  const resetForm = useCallback((newValues: Record<string, unknown>) => {
    setValues(newValues)
    setFormKey((k: number) => k + 1)
    setActiveVersionId(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Rejoin collaborative mode. */
  const rejoinLive = useCallback(() => {
    setFormKey(0)
    setActiveVersionId(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setFormValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: [] }))
  }, [])

  function setValue(name: string, value: unknown) {
    setFormValue(name, value)
    // Don't sync to Y.Doc during restore preview — form is non-collaborative
    if (isRestorePreview) return
    // Don't double-sync fields that handle their own Y.Doc sync
    if (setCollaborativeValue && !selfSyncFields?.has(name)) {
      setCollaborativeValue(name, value)
    }
  }

  async function handleSave(publishAction?: 'draft' | 'publish' | 'unpublish') {
    setSaving(true)
    setErrors({})
    try {
      // Don't sync to Y.Doc before save if in restore preview
      if (yjs && syncAllFieldsToDoc && !isRestorePreview) {
        syncAllFieldsToDoc(values)
      }

      const payload = { ...values } as Record<string, unknown>

      if (draftable && publishAction) {
        payload['draftStatus'] = publishAction === 'publish' ? 'published' : 'draft'
      }

      const res = await fetch(`/${pathSegment}/api/${slug}/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
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

      if (versioned) {
        await fetch(`/${pathSegment}/api/${slug}/${id}/_versions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: null,
            fields: values,
            ...(draftable && publishAction ? { draftStatus: publishAction === 'publish' ? 'published' : 'draft' } : {}),
          }),
        })
      }

      if (draftable && publishAction === 'publish') {
        toast.success(i18n.publishedToastDraft ?? 'Published successfully.')
      } else if (draftable && publishAction === 'unpublish') {
        toast.success(i18n.unpublishedToast ?? 'Unpublished.')
      } else if (draftable && publishAction === 'draft') {
        toast.success(i18n.savedDraftToast ?? 'Draft saved.')
      } else {
        toast.success(i18n.savedToast)
      }

      if (yjs && isRestorePreview) {
        // Push restored values to the shared Y.Doc (still connected)
        // so other users get the update in real-time
        if (syncAllFieldsToDoc) syncAllFieldsToDoc(values)

        // Clear per-field Y.Doc rooms on server so they re-seed from DB next time
        isSyncingRef.current = true
        await fetch(`/${pathSegment}/api/${slug}/${id}/_sync-live`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        isSyncingRef.current = false
      }

      onSaved?.()
      void navigate(backHref)
    } catch {
      toast.error(i18n.saveError)
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (draftable) {
      await handleSave('draft')
    } else {
      await handleSave()
    }
  }

  async function restoreVersion(versionId: string) {
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/${id}/_versions/${versionId}`)
      if (res.ok) {
        const body = await res.json() as { data: { fields: Record<string, unknown> } }
        const restoredFields = body.data.fields
        const merged = { ...values, ...restoredFields }

        resetForm(merged)
        setActiveVersionId(versionId)
        toast.success(i18n.restoredToast ?? 'Version restored.')
      } else {
        toast.error(i18n.restoreError ?? 'Failed to restore version.')
      }
    } catch {
      toast.error(i18n.restoreError ?? 'Failed to restore version.')
    }
  }

  return {
    values,
    errors,
    saving,
    activeVersionId,
    isRestorePreview,
    setValue,
    setFormValue,
    resetForm,
    rejoinLive,
    handleSave,
    handleSubmit,
    restoreVersion,
  }
}
