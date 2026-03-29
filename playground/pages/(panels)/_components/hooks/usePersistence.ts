'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface PersistenceConfig {
  /** Remember mode: 'session' | 'localStorage' | 'url' or undefined */
  rememberMode?: string
  /** Element ID for storage keys */
  elementId:     string
  /** Panel path for API calls */
  panelPath:     string
}

interface ViewConfig {
  viewOptions:  { name: string; type?: string }[]
  defaultView:  string
  ssrActiveView?: string
  defaultViewBreakpoints?: Record<string, string>
}

/**
 * Hook for view state persistence (remember mode) and responsive default view.
 */
export function usePersistence(
  config: PersistenceConfig,
  viewConfig: ViewConfig,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const { rememberMode, elementId, panelPath } = config
  const { viewOptions, defaultView, ssrActiveView, defaultViewBreakpoints } = viewConfig

  const [activeView, setActiveView] = useState(ssrActiveView ?? defaultView)
  const initializedRef = useRef(false)

  // ── Save state to session (persist/remember feature) ──
  const saveRememberState = useCallback((state: Record<string, unknown>) => {
    if (!rememberMode || rememberMode === 'localStorage') return
    if (rememberMode === 'session') {
      void fetch(`${panelPath}/api/_tables/${elementId}/remember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      })
    }
  }, [rememberMode, panelPath, elementId])

  // ── Container-based responsive default view (first visit only) ──
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    // Skip if user already has a persisted view
    if (ssrActiveView) return
    if (!defaultViewBreakpoints || !containerRef.current) return
    const width = containerRef.current.clientWidth
    const bp = width < 480 ? 'sm' : width < 768 ? 'md' : 'lg'
    const target = defaultViewBreakpoints[bp] ?? defaultViewBreakpoints['lg'] ?? defaultViewBreakpoints['md'] ?? defaultViewBreakpoints['sm']
    if (target && target !== activeView) {
      setActiveView(target)
      saveRememberState({ view: target })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── View change handler (re-fetches when view type changes) ──
  function handleViewChange(
    viewName: string,
    fetchData: (opts: { page: number; viewType?: string; folder?: string | null }) => Promise<void>,
    currentFolder: string | null,
    buildState: (overrides: Record<string, unknown>) => Record<string, unknown>,
  ) {
    setActiveView(viewName)
    const targetView = viewOptions.find(v => v.name === viewName)
    const prevView = viewOptions.find(v => v.name === activeView)
    const targetType = targetView?.type
    const prevType = prevView?.type

    const needsAllRecords = targetType === 'tree'
    const needsFolderFilter = targetType === 'folder'
    const hadAllRecords = prevType === 'tree'
    const hadFolderFilter = prevType === 'folder'

    if (needsAllRecords !== hadAllRecords || needsFolderFilter !== hadFolderFilter) {
      if (needsAllRecords) {
        void fetchData({ page: 1, viewType: 'tree', folder: null })
      } else if (needsFolderFilter) {
        void fetchData({ page: 1, viewType: 'folder', folder: currentFolder })
      } else {
        void fetchData({ page: 1, folder: null, viewType: targetType })
      }
    }

    saveRememberState(buildState({ view: viewName }))
  }

  return {
    activeView,
    setActiveView,
    saveRememberState,
    handleViewChange,
  }
}
