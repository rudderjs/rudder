import { useEffect, useRef } from 'react'
import { navigate } from 'vike/client/router'

/**
 * Subscribe to live table updates for a resource.
 * On any CRUD broadcast, triggers a Vike re-navigation to refetch SSR data.
 * Uses BKSocket from @boostkit/broadcast (published to src/).
 */
export function useLiveTable(options: {
  enabled:     boolean
  slug:        string
  pathSegment: string
}) {
  const socketRef = useRef<unknown>(null)

  useEffect(() => {
    if (!options.enabled || typeof window === 'undefined') return

    let destroyed = false

    async function connect() {
      // BKSocket is published to the app's src/ directory via vendor:publish
      let BKSocket: new (url: string) => {
        channel(name: string): {
          on(event: string, handler: (data: unknown) => void): unknown
        }
        disconnect(): void
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-ts-comment
        // @ts-expect-error — Vite resolves this runtime path; no static module declaration
        const mod = await import('/src/BKSocket.ts') as any
        BKSocket = mod.BKSocket
      } catch {
        return // BKSocket not available
      }

      if (destroyed || !BKSocket) return

      const wsUrl = `ws://${window.location.host}/ws`
      const socket = new BKSocket(wsUrl)
      socketRef.current = socket

      const channel = socket.channel(`panel:${options.slug}`)

      const refetch = () => {
        void navigate(window.location.pathname + window.location.search, {
          overwriteLastHistoryEntry: true,
        })
      }

      channel.on('record.created',  refetch)
      channel.on('record.updated',  refetch)
      channel.on('record.deleted',  refetch)
      channel.on('records.deleted', refetch)
      channel.on('action.executed', refetch)
    }

    void connect()

    return () => {
      destroyed = true
      if (socketRef.current) {
        ;(socketRef.current as { disconnect(): void }).disconnect()
        socketRef.current = null
      }
    }
  }, [options.enabled, options.slug, options.pathSegment])
}
