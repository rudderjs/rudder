'use client'

import { useEffect } from 'react'

interface LiveUpdateConfig {
  /** Poll interval in ms (undefined = no polling) */
  pollInterval?:  number
  /** Enable WebSocket live updates */
  live?:          boolean
  /** WebSocket channel name */
  liveChannel?:   string
  /** Element ID for dependency tracking */
  elementId:      string
}

interface StateRefs {
  currentPage:   React.MutableRefObject<number>
  search:        React.MutableRefObject<string>
  sortField:     React.MutableRefObject<string>
  sortDir:       React.MutableRefObject<string>
  activeScope:   React.MutableRefObject<number>
  currentFolder: React.MutableRefObject<string | null>
}

/**
 * Hook for live updates (polling + WebSocket) in SchemaDataView.
 * Uses refs to avoid stale closures in intervals/WS handlers.
 */
export function useLiveUpdates(
  config: LiveUpdateConfig,
  stateRefs: StateRefs,
  fetchData: (opts?: { page?: number; search?: string; sort?: string; dir?: string; scope?: number; folder?: string | null }) => Promise<void>,
): void {
  // ── Polling ──
  useEffect(() => {
    if (!config.pollInterval) return
    const interval = setInterval(() => {
      void fetchData({
        page:   stateRefs.currentPage.current,
        search: stateRefs.search.current,
        sort:   stateRefs.sortField.current || undefined,
        dir:    stateRefs.sortDir.current,
        scope:  stateRefs.activeScope.current,
        folder: stateRefs.currentFolder.current,
      })
    }, config.pollInterval)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.pollInterval, config.elementId])

  // ── Live updates via WebSocket ──
  useEffect(() => {
    if (!config.live || !config.liveChannel) return
    const liveChannel = config.liveChannel
    let destroyed = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let socket: any = null

    ;(async () => {
      try {
        const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const wsUrl = `${wsProto}://${window.location.host}/ws`
        const ws = new WebSocket(wsUrl)
        socket = ws

        ws.onopen = () => {
          if (destroyed) { ws.close(); return }
          ws.send(JSON.stringify({ type: 'subscribe', channel: liveChannel }))
        }

        ws.onmessage = (event: MessageEvent) => {
          if (destroyed) return
          try {
            const msg = JSON.parse(String(event.data)) as { type: string; channel?: string }
            if (msg.type === 'event' && msg.channel === liveChannel) {
              void fetchData({
                page:   stateRefs.currentPage.current,
                search: stateRefs.search.current || undefined,
                sort:   stateRefs.sortField.current || undefined,
                dir:    stateRefs.sortDir.current,
                scope:  stateRefs.activeScope.current,
                folder: stateRefs.currentFolder.current,
              })
            }
          } catch { /* ignore */ }
        }

        ws.onclose = () => { socket = null }
      } catch { /* WebSocket not available */ }
    })()

    return () => {
      destroyed = true
      if (socket) {
        try { socket.send(JSON.stringify({ type: 'unsubscribe', channel: liveChannel })) } catch { /* ignore */ }
        socket.close()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.live, config.liveChannel])
}
