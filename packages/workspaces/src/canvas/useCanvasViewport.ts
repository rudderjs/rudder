import { useState, useCallback, useEffect } from 'react'

// ─── Types ───────────────────────────────────────────────

export interface CanvasViewport {
  zoom: number
  panX: number
  panY: number
}

export interface UseCanvasViewportOptions {
  /** Storage key (e.g. 'workspace:ws-123:viewport') */
  storageKey: string
  /** Whether to persist to localStorage */
  persist?: boolean | undefined
  /** Default viewport */
  defaults?: Partial<CanvasViewport> | undefined
}

export interface UseCanvasViewportReturn {
  viewport: CanvasViewport
  setViewport: (v: Partial<CanvasViewport>) => void
  resetViewport: () => void
}

// ─── Hook ────────────────────────────────────────────────

const DEFAULT_VIEWPORT: CanvasViewport = { zoom: 1, panX: 0, panY: 0 }

/**
 * Per-user viewport state (zoom, pan) persisted to localStorage.
 * Each user has their own viewport — not synced via Yjs.
 */
export function useCanvasViewport(opts: UseCanvasViewportOptions): UseCanvasViewportReturn {
  const { storageKey, persist = false, defaults } = opts
  const defaultViewport = { ...DEFAULT_VIEWPORT, ...defaults }

  const [viewport, setViewportState] = useState<CanvasViewport>(() => {
    if (!persist || typeof window === 'undefined') return defaultViewport
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) return { ...defaultViewport, ...JSON.parse(stored) }
    } catch { /* ignore */ }
    return defaultViewport
  })

  // Persist on change
  useEffect(() => {
    if (!persist || typeof window === 'undefined') return
    try {
      localStorage.setItem(storageKey, JSON.stringify(viewport))
    } catch { /* ignore */ }
  }, [persist, storageKey, viewport])

  const setViewport = useCallback((v: Partial<CanvasViewport>) => {
    setViewportState(prev => ({ ...prev, ...v }))
  }, [])

  const resetViewport = useCallback(() => {
    setViewportState(defaultViewport)
    if (persist && typeof window !== 'undefined') {
      try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, persist])

  return { viewport, setViewport, resetViewport }
}
