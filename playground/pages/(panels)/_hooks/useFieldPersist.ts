import { useEffect, useRef, useCallback } from 'react'
import type { FieldMeta } from '@pilotiq/panels'

interface UseFieldPersistOptions {
  /** Storage key prefix — e.g. 'bk:admin:articles:create' */
  storageKeyPrefix: string
  /** All form fields (filtered internally for persist === 'localStorage'). */
  formFields: FieldMeta[]
  /** Current form values. */
  values: Record<string, unknown>
  /** Setter to silently restore a field value. */
  setValue: (name: string, value: unknown) => void
}

const DEBOUNCE = 800

/**
 * Per-field localStorage persistence.
 * Only handles fields with `.persist()` (localStorage mode).
 * Silently saves and auto-restores — no banner, no prompt.
 */
export function useFieldPersist(opts: UseFieldPersistOptions) {
  const { storageKeyPrefix, formFields, values, setValue } = opts

  // Fields that use localStorage persist
  const persistFieldNames = formFields
    .filter(f => f.persist === 'localStorage')
    .map(f => f.name)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restoredRef = useRef(false)

  // ── Silent restore on mount ───────────────────────────────
  useEffect(() => {
    if (persistFieldNames.length === 0 || typeof window === 'undefined') return
    if (restoredRef.current) return
    restoredRef.current = true

    for (const name of persistFieldNames) {
      const key = `${storageKeyPrefix}:f:${name}`
      try {
        const raw = localStorage.getItem(key)
        if (raw !== null) {
          const parsed = JSON.parse(raw) as { v: unknown }
          setValue(name, parsed.v)
        }
      } catch { /* corrupt — ignore */ }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Debounced write on value changes ──────────────────────
  useEffect(() => {
    if (persistFieldNames.length === 0 || typeof window === 'undefined') return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      for (const name of persistFieldNames) {
        const key = `${storageKeyPrefix}:f:${name}`
        try {
          localStorage.setItem(key, JSON.stringify({ v: values[name] }))
        } catch { /* quota — ignore */ }
      }
    }, DEBOUNCE)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [storageKeyPrefix, values]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Clear all persisted field values (call after successful save). */
  const clearPersistedFields = useCallback(() => {
    for (const name of persistFieldNames) {
      localStorage.removeItem(`${storageKeyPrefix}:f:${name}`)
    }
  }, [storageKeyPrefix, persistFieldNames.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  return { clearPersistedFields }
}
