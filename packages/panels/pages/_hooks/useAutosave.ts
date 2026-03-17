import { useState, useEffect, useRef, useCallback } from 'react'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface UseAutosaveOptions {
  /** Whether autosave is enabled (from resource meta). */
  enabled: boolean
  /** Autosave interval in ms. */
  interval: number
  /** API endpoint — e.g. '/admin/api/articles/123' */
  endpoint: string
  /** Current form values. */
  values: Record<string, unknown>
  /** Initial/baseline values — autosave only fires when dirty. */
  initialValues: Record<string, unknown>
  /** Whether a manual save is in progress (skip autosave). */
  saving: boolean
  /** Whether the form is in restore preview mode (skip autosave). */
  isRestorePreview: boolean
  /** Sync collaborative fields before save. */
  syncAllFieldsToDoc?: ((values: Record<string, unknown>) => void) | undefined
  /** Whether form uses Yjs. */
  yjs: boolean
  /** Called on successful autosave — used to clear persist draft. */
  onSaved?: (() => void) | undefined
  /** Called on validation error — set form errors. */
  onValidationError?: ((errors: Record<string, string[]>) => void) | undefined
}

function isDirty(current: Record<string, unknown>, initial: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(current), ...Object.keys(initial)])
  for (const key of keys) {
    if (JSON.stringify(current[key]) !== JSON.stringify(initial[key])) return true
  }
  return false
}

export function useAutosave(opts: UseAutosaveOptions) {
  const {
    enabled, interval, endpoint, values, initialValues,
    saving, isRestorePreview, syncAllFieldsToDoc, yjs,
    onSaved, onValidationError,
  } = opts

  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const lastSavedRef = useRef<string>(JSON.stringify(initialValues))
  const valuesRef = useRef(values)
  valuesRef.current = values

  // Track the latest options via ref to avoid stale closures in the interval
  const optsRef = useRef(opts)
  optsRef.current = opts

  const doAutosave = useCallback(async () => {
    const currentOpts = optsRef.current
    const currentValues = valuesRef.current
    const serialized = JSON.stringify(currentValues)

    // Skip if: manual save in progress, restore preview, or nothing changed since last autosave
    if (currentOpts.saving || currentOpts.isRestorePreview) return
    if (serialized === lastSavedRef.current) return
    if (!isDirty(currentValues, currentOpts.initialValues)) return

    // Sync collaborative fields
    if (currentOpts.yjs && currentOpts.syncAllFieldsToDoc) {
      currentOpts.syncAllFieldsToDoc(currentValues)
    }

    setStatus('saving')
    try {
      const res = await fetch(currentOpts.endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
      })
      if (res.status === 422) {
        const body = await res.json() as { errors: Record<string, string[]> }
        currentOpts.onValidationError?.(body.errors)
        setStatus('error')
        return
      }
      if (!res.ok) {
        setStatus('error')
        return
      }
      lastSavedRef.current = serialized
      setStatus('saved')
      currentOpts.onSaved?.()
    } catch {
      setStatus('error')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Interval timer ──────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => { void doAutosave() }, interval)
    return () => clearInterval(timer)
  }, [enabled, interval, doAutosave])

  // ── Reset status to idle after "saved" fades ────────────────
  useEffect(() => {
    if (status === 'saved') {
      const timer = setTimeout(() => setStatus('idle'), 3000)
      return () => clearTimeout(timer)
    }
  }, [status])

  // ── Track dirty state for UI ────────────────────────────────
  const dirty = enabled && isDirty(values, initialValues) && JSON.stringify(values) !== lastSavedRef.current

  // Reset baseline after manual save
  const resetBaseline = useCallback(() => {
    lastSavedRef.current = JSON.stringify(valuesRef.current)
    setStatus('saved')
  }, [])

  return {
    autosaveStatus: status,
    autosaveDirty: dirty,
    resetBaseline,
  }
}
