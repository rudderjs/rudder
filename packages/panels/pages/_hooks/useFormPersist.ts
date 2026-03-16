import { useState, useEffect, useRef, useCallback } from 'react'

interface StoredDraft {
  values: Record<string, unknown>
  timestamp: number
}

interface UseFormPersistOptions {
  /** localStorage key — e.g. 'bk:admin:articles:create' or 'bk:admin:articles:123:edit' */
  storageKey: string
  /** Whether persistence is enabled (from resource meta). */
  enabled: boolean
  /** Current form values. */
  values: Record<string, unknown>
  /** Initial/baseline values to compare against for dirty detection. */
  initialValues: Record<string, unknown>
  /** Called when the user clicks "Restore" on the banner. */
  onRestore: (values: Record<string, unknown>) => void
}

/** Debounce delay for writing to localStorage (ms). */
const WRITE_DEBOUNCE = 1000

function isDirty(current: Record<string, unknown>, initial: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(current), ...Object.keys(initial)])
  for (const key of keys) {
    if (JSON.stringify(current[key]) !== JSON.stringify(initial[key])) return true
  }
  return false
}

export function useFormPersist(opts: UseFormPersistOptions) {
  const { storageKey, enabled, values, initialValues, onRestore } = opts

  // Draft found in localStorage on mount
  const [storedDraft, setStoredDraft] = useState<StoredDraft | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Baseline tracks the last-saved state. Starts as initialValues (DB load),
  // updated on every successful save (manual or autosave).
  const baselineRef = useRef<string>(JSON.stringify(initialValues))
  const valuesRef = useRef(values)
  valuesRef.current = values

  // ── Check localStorage on mount ─────────────────────────────
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const draft = JSON.parse(raw) as StoredDraft
        // Only show banner if the stored draft differs from the current initial values
        if (isDirty(draft.values, initialValues)) {
          setStoredDraft(draft)
        } else {
          localStorage.removeItem(storageKey)
        }
      }
    } catch { /* corrupt data — ignore */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Debounced write to localStorage on value changes ────────
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      // Only persist if values differ from the last-saved baseline
      const serialized = JSON.stringify(values)
      if (serialized !== baselineRef.current) {
        try {
          const draft: StoredDraft = { values, timestamp: Date.now() }
          localStorage.setItem(storageKey, JSON.stringify(draft))
        } catch { /* quota exceeded — ignore */ }
      }
    }, WRITE_DEBOUNCE)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [enabled, storageKey, values]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── beforeunload warning ────────────────────────────────────
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      // Compare against the last-saved baseline, not the original DB load
      if (JSON.stringify(valuesRef.current) !== baselineRef.current) {
        e.preventDefault()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [enabled])

  // ── Actions ─────────────────────────────────────────────────
  const restore = useCallback(() => {
    if (storedDraft) {
      onRestore(storedDraft.values)
      setStoredDraft(null)
      setBannerDismissed(true)
      localStorage.removeItem(storageKey)
    }
  }, [storedDraft, onRestore, storageKey])

  const dismiss = useCallback(() => {
    setStoredDraft(null)
    setBannerDismissed(true)
    localStorage.removeItem(storageKey)
  }, [storageKey])

  /** Call after a successful save (manual or autosave) to clear the persisted draft. */
  const clearDraft = useCallback(() => {
    // Update baseline to current values — form is no longer dirty
    baselineRef.current = JSON.stringify(valuesRef.current)
    localStorage.removeItem(storageKey)
  }, [storageKey])

  const showBanner = enabled && storedDraft !== null && !bannerDismissed
  const dirty = JSON.stringify(values) !== baselineRef.current

  return {
    showBanner,
    storedTimestamp: storedDraft?.timestamp ?? null,
    restore,
    dismiss,
    clearDraft,
    isDirty: dirty,
  }
}
