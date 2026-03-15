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
  collaborative: boolean
  i18n:          PanelI18n & Record<string, string>
  // Collaborative callbacks (optional)
  syncAllFieldsToDoc?:    (values: Record<string, unknown>) => void
  setCollaborativeValue?: (name: string, value: unknown) => void
  /** Fields that handle their own Y.Doc sync (each via its own Lexical + Y.Doc instance).
   *  setValue will NOT call setCollaborativeValue for these — they already sync themselves. */
  selfSyncFields?:        Set<string>
  /** Setter for formKey — lives in parent so useCollaborativeForm can use it as resetKey. */
  setFormKey:              (fn: (k: number) => number) => void
}

export function useEditForm(opts: UseEditFormOptions) {
  const {
    pathSegment, slug, id, initialValues, backHref,
    versioned, draftable, collaborative, i18n,
    syncAllFieldsToDoc, setCollaborativeValue, selfSyncFields, setFormKey,
  } = opts

  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [activeVersionId, setActiveVersionId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('restoredVersion')
  })

  /** Reset form with new values and remount collaborative editors. */
  const resetForm = useCallback((newValues: Record<string, unknown>) => {
    setValues(newValues)
    setFormKey(k => k + 1)
    setActiveVersionId(null)
  }, [])

  const setFormValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: [] }))
  }, [])

  function setValue(name: string, value: unknown) {
    setFormValue(name, value)
    // Don't double-sync fields that handle their own Y.Doc sync
    // Text-based collaborative fields each have their own Y.Doc + Lexical instance
    if (setCollaborativeValue && !selfSyncFields?.has(name)) {
      setCollaborativeValue(name, value)
    }
  }

  async function handleSave(publishAction?: 'draft' | 'publish' | 'unpublish') {
    setSaving(true)
    setErrors({})
    try {
      if (collaborative && syncAllFieldsToDoc) {
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

        // Save restored values to DB so +data.ts reads them on navigation
        await fetch(`/${pathSegment}/api/${slug}/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(merged),
        })

        // Clear server-side Y.Docs so fresh rooms seed from restored DB values
        if (collaborative) {
          await fetch(`/${pathSegment}/api/${slug}/${id}/_clear-live`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
        }

        toast.success(i18n.restoredToast ?? 'Version restored.')

        // Client-side navigation — re-runs +data.ts (reads restored DB values),
        // remounts the entire page with fresh state. No window.location.reload().
        const params = new URLSearchParams(window.location.search)
        params.set('restoredVersion', versionId)
        await navigate(`/${pathSegment}/${slug}/${id}/edit?${params.toString()}`, {
          overwriteLastHistoryEntry: true,
        })
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
    setValue,
    setFormValue,
    resetForm,
    handleSave,
    handleSubmit,
    restoreVersion,
  }
}
