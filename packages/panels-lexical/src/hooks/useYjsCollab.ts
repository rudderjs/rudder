import { useMemo, useRef, useState, useEffect } from 'react'

// ─── Types ──────────────────────────────────────────────────

/** Minimal structural interface for a Yjs WebSocket provider. */
export interface YjsProvider {
  awareness: { setLocalStateField(field: string, state: Record<string, unknown>): void }
  once(event: string, callback: () => void): void
  destroy(): void
}

export interface YjsCollabRef {
  doc:      import('yjs').Doc
  provider: YjsProvider
  Y:        typeof import('yjs')
}

export interface UseYjsCollabOptions {
  /** WebSocket path (e.g. '/ws-live'). Null/undefined = no collaboration. */
  wsPath?:       string | null | undefined
  /** Base document name — room = `${docName}:${fragmentName}` */
  docName?:      string | null | undefined
  /** Fragment name — unique per editor instance */
  fragmentName:  string
  /** Display name for cursors */
  userName?:     string | undefined
  /** Cursor color (CSS color) */
  userColor?:    string | undefined
}

export interface UseYjsCollabReturn {
  /** Whether Y.Doc + provider are ready */
  collabReady:    boolean
  /** Whether initial server sync has completed */
  providerSynced: boolean
  /** Ref to the collab state (doc, provider, Y module) */
  collabRef:      React.MutableRefObject<YjsCollabRef | null>
  /** Whether collaboration is active (wsPath + docName both present) */
  isCollab:       boolean
  /**
   * Memoized provider factory for Lexical's CollaborationPlugin.
   * Undefined when collab is not ready.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerFactory: ((id: string, yjsDocMap: Map<string, any>) => any) | undefined
}

// ─── Hook ───────────────────────────────────────────────────

/**
 * Shared Yjs collaboration setup for Lexical editors.
 *
 * Creates a per-editor Y.Doc + WebSocket provider. Each editor instance
 * gets its own document because Lexical's createBinding hardcodes
 * `doc.get('root', XmlText)` — multiple editors sharing one Y.Doc
 * would bind to the same fragment.
 *
 * Used by both LexicalEditor (rich text) and CollaborativePlainText.
 */
export function useYjsCollab(opts: UseYjsCollabOptions): UseYjsCollabReturn {
  const { wsPath, docName, fragmentName, userName, userColor } = opts
  const isCollab = !!(wsPath && docName)

  const [collabReady, setCollabReady]       = useState(false)
  const [providerSynced, setProviderSynced] = useState(false)
  const collabRef = useRef<YjsCollabRef | null>(null)

  useEffect(() => {
    if (!isCollab) return
    let destroyed = false

    Promise.all([import('yjs'), import('y-websocket')]).then(([Y, ws]) => {
      if (destroyed) return

      const doc = new Y.Doc()
      const wsProto  = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl    = `${wsProto}://${window.location.host}${wsPath}`
      const roomName = `${docName}:${fragmentName}`

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- y-websocket CJS interop
      const provider = new (ws as any).WebsocketProvider(wsUrl, roomName, doc, { connect: false }) as YjsProvider
      provider.awareness.setLocalStateField('user', {
        name:  userName  ?? `User-${Math.floor(Math.random() * 1000)}`,
        color: userColor ?? `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`,
      })

      provider.once('synced', () => {
        if (!destroyed) setProviderSynced(true)
      })

      collabRef.current = { doc, provider, Y }
      setCollabReady(true)
    })

    return () => {
      destroyed = true
      collabRef.current?.provider?.destroy()
      collabRef.current?.doc?.destroy()
      collabRef.current = null
      setCollabReady(false)
      setProviderSynced(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- userName/userColor intentionally excluded (read once on setup)
  }, [wsPath, docName, fragmentName])

  // Memoize provider factory — must be stable so CollaborationPlugin
  // doesn't disconnect/reconnect on every re-render.
  const providerFactory = useMemo(() => {
    if (!collabReady || !collabRef.current) return undefined
    const { doc, provider } = collabRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lexical's ProviderFactory uses Map<string, any>
    return (_id: string, yjsDocMap: Map<string, any>) => {
      yjsDocMap.set(_id, doc)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cast to satisfy Lexical's Provider type
      return provider as unknown as any
    }
  }, [collabReady])

  return { collabReady, providerSynced, collabRef, isCollab, providerFactory }
}
