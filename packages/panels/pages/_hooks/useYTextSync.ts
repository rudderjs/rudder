import { useCallback, useRef, useEffect } from 'react'

/**
 * Sync a local text value with a Y.Text instance using minimal diffs (quill-delta).
 *
 * Returns `applyLocalChange(newValue)` — call this instead of the raw onChange.
 * The hook also observes Y.Text for remote changes and calls `onRemoteChange`.
 */
export function useYTextSync(
  yText:          any | null,
  onRemoteChange: (newValue: string) => void,
) {
  const suppressRef = useRef(false)
  const deltaRef    = useRef<any>(null)

  // Lazy-load quill-delta
  useEffect(() => {
    import('quill-delta').then(mod => {
      deltaRef.current = mod.default ?? mod
    })
  }, [])

  // Observe Y.Text for remote changes
  useEffect(() => {
    if (!yText) return

    function handler(_event: any, transaction: any) {
      if (suppressRef.current) {
        suppressRef.current = false
        return
      }
      if (transaction.local) return
      onRemoteChange(yText.toString())
    }

    yText.observe(handler)
    return () => yText.unobserve(handler)
  }, [yText, onRemoteChange])

  /** Apply a local text change to Y.Text using minimal diff */
  const applyLocalChange = useCallback((newValue: string) => {
    if (!yText) return
    const Delta = deltaRef.current
    if (!Delta) {
      // Fallback: replace all text
      yText.doc?.transact(() => {
        yText.delete(0, yText.length)
        if (newValue) yText.insert(0, newValue)
      })
      return
    }

    const oldValue = yText.toString()
    if (oldValue === newValue) return

    // Compute minimal diff using quill-delta
    const oldDelta = new Delta().insert(oldValue)
    const newDelta = new Delta().insert(newValue)
    const diff     = oldDelta.diff(newDelta)

    suppressRef.current = true
    yText.doc?.transact(() => {
      let index = 0
      for (const op of diff.ops) {
        if (op.retain) {
          index += op.retain
        } else if (op.insert) {
          yText.insert(index, op.insert)
          index += op.insert.length
        } else if (op.delete) {
          yText.delete(index, op.delete)
        }
      }
    })
  }, [yText])

  return { applyLocalChange }
}
