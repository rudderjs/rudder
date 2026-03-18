/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

interface CollaborativeField {
  name:          string
  yjs?: boolean
  /** Set to true for text/textarea/content fields that should use Y.Text for character-level sync */
  textField?:    boolean
}

interface CollaborativeFormOptions {
  docName:    string
  wsPath:     string
  fields:     CollaborativeField[]
  values:     Record<string, unknown>
  /** Lazy getter for current form values — used by seedAfterSync to avoid stale closures. */
  getValues?: () => Record<string, unknown>
  setValue:   (name: string, value: unknown) => void
  /** Client-side providers. Default: ['websocket'] */
  providers?: ('websocket' | 'indexeddb')[]
  /** Change this to force reconnect (e.g. on version restore). */
  resetKey?:  number
}

interface Presence { name: string; color: string }

interface CollaborativeFormReturn {
  connected:             boolean
  /** True after the initial ydoc sync from server completes. Safe to seed Y.Text after this. */
  synced:                boolean
  presences:             Presence[]
  setCollaborativeValue: (name: string, value: unknown) => void
  syncAllFieldsToDoc:    (allValues: Record<string, unknown>) => void
  /** Get Y.Text instance for a text field. Returns null if not connected or field is not a text field. */
  getYText:              (fieldName: string) => any | null
  /** Get the Y.Doc instance. */
  getDoc:                () => any | null
  /** Get the awareness instance. Returns null if not connected. */
  awareness:             any | null
  /** Stable user identity — same name/color for input/textarea cursors and Lexical cursors. */
  userName:              string
  userColor:             string
}

/**
 * Connect to a Yjs ydoc via y-websocket, sync collaborative fields
 * bidirectionally with React form state, and provide presence data.
 *
 * Text fields (textField: true) use Y.Text for character-level CRDT.
 * Other fields use Y.Map for opaque value sync.
 *
 * Supports multiple providers:
 * - `'websocket'` — real-time sync with server via y-websocket
 * - `'indexeddb'` — local persistence in browser IndexedDB (survives refresh)
 *
 * Pass `null` to disable (non-versioned resources).
 */
export function useCollaborativeForm(options: CollaborativeFormOptions | null): CollaborativeFormReturn {
  const [connected, setConnected] = useState(false)
  const [synced, setSynced] = useState(false)
  const [presences, setPresences] = useState<Presence[]>([])
  const [awareness, setAwareness] = useState<any>(null)
   
  const providerRef  = useRef<any>(null)
   
  const idbRef       = useRef<any>(null)
   
  const docRef       = useRef<any>(null)
   
  const awarenessRef = useRef<any>(null)
  const suppressRef  = useRef<Set<string>>(new Set())
  /** Map of fieldName → Y.Text for text fields */
  const yTextMapRef  = useRef<Map<string, any>>(new Map())

  // Stable user identity — generated once per hook instance, shared by
  // input/textarea cursors (useYTextCursors) and Lexical (CollaborationPlugin).
  const { userName, userColor } = useMemo(() => ({
    userName:  `User-${Math.floor(Math.random() * 1000)}`,
    userColor: `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`,
  }), [])

  useEffect(() => {
    if (!options) return
    const opts = options
    let destroyed = false
    const providers = opts.providers ?? ['websocket']
    const useWebsocket = providers.includes('websocket')
    const useIndexeddb = providers.includes('indexeddb')

    async function connect() {
       
      const Y = await import('yjs' as any)
      if (destroyed) return

      const doc = new Y.Doc()
      docRef.current = doc

      const fieldsMap  = doc.getMap('fields')
      const textFields = opts.fields.filter(f => f.yjs && f.textField)
      const mapFields  = opts.fields.filter(f => f.yjs && !f.textField)

      // Create Y.Text instances for text fields
      const yTexts = new Map<string, any>()
      for (const f of textFields) {
        const yText = doc.getText(`field:${f.name}`)
        yTexts.set(f.name, yText)
      }
      yTextMapRef.current = yTexts

      // Observe Y.Text changes → update React state
      for (const f of textFields) {
        const yText = yTexts.get(f.name)
        if (!yText) continue
        yText.observe(() => {
          if (suppressRef.current.has(f.name)) {
            suppressRef.current.delete(f.name)
            return
          }
          opts.setValue(f.name, yText.toString())
        })
      }

      // Observe Y.Map changes for non-text fields → update React state
       
      fieldsMap.observe((event: any) => {
         
        event.keysChanged.forEach((key: string) => {
          if (suppressRef.current.has(key)) { suppressRef.current.delete(key); return }
          const field = mapFields.find(f => f.name === key)
          if (field) opts.setValue(key, fieldsMap.get(key))
        })
      })

      // Seed initial content AFTER first sync from server.
      // If we seed before sync, both the seed and server state merge → duplicated text.
      function seedAfterSync() {
        if (destroyed) return
        // Use getValues() for latest form values (avoids stale closure after version restore)
        const vals = opts.getValues?.() ?? opts.values
        doc.transact(() => {
          for (const f of textFields) {
            const yText = yTexts.get(f.name)
            if (!yText) continue
            const initVal = String(vals[f.name] ?? '')
            if (yText.length === 0 && initVal) {
              yText.insert(0, initVal)
            }
          }
          for (const f of mapFields) {
            if (!fieldsMap.has(f.name)) fieldsMap.set(f.name, vals[f.name] ?? null)
          }
        })
      }

      // ── IndexedDB provider (offline persistence) ──────────
      if (useIndexeddb) {
         
        import('y-indexeddb' as any).then(({ IndexeddbPersistence }: any) => {
          if (destroyed) return
          const idb = new IndexeddbPersistence(opts.docName, doc)
          idbRef.current = idb

          // If no WebSocket, seed after IDB syncs (restores offline data)
          if (!useWebsocket) {
            idb.once('synced', () => {
              seedAfterSync()
              setSynced(true)
            })
          }
        }).catch(e => {
          console.warn('[useCollaborativeForm] y-indexeddb not available:', e)
          // If IDB was the only provider, seed immediately as fallback
          if (!useWebsocket) {
            seedAfterSync()
            setSynced(true)
          }
        })
      }

      // ── WebSocket provider (real-time collaboration) ────────
      if (useWebsocket) {
         
        const { WebsocketProvider } = await import('y-websocket' as any) as any
        if (destroyed) return

        const wsProto  = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const wsUrl    = `${wsProto}://${window.location.host}${opts.wsPath}`
        const wsProvider = new WebsocketProvider(wsUrl, opts.docName, doc)

        providerRef.current  = wsProvider
        awarenessRef.current = wsProvider.awareness
        setAwareness(wsProvider.awareness)

        // Set user presence
        wsProvider.awareness.setLocalStateField('user', { name: userName, color: userColor })

        // Connection status
        wsProvider.on('status', ({ status }: { status: string }) => {
          setConnected(status === 'connected')
        })

        // Presence
        const syncPresences = () => {
          const states = [...wsProvider.awareness.getStates().values()] as { user?: Presence }[]
          setPresences(states.flatMap(s => s.user ? [s.user] : []))
        }
        syncPresences()
        wsProvider.awareness.on('change', syncPresences)

        // Seed form fields (Y.Map) after WS sync
        wsProvider.once('synced', () => {
          seedAfterSync()
          setSynced(true)
        })
      }

      // No providers at all — seed immediately
      if (!useWebsocket && !useIndexeddb) {
        seedAfterSync()
        setSynced(true)
      }
    }

    void connect()
    return () => {
      destroyed = true
      providerRef.current?.destroy()
      idbRef.current?.destroy()
      docRef.current?.destroy()
      providerRef.current  = null
      idbRef.current       = null
      docRef.current       = null
      awarenessRef.current = null
      setAwareness(null)
      yTextMapRef.current  = new Map()
    }
  }, [options?.docName, options?.resetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Write a local change to the ydoc. Handles both Y.Text and Y.Map fields. */
  const setCollaborativeValue = useCallback((name: string, value: unknown) => {
    const doc = docRef.current
    if (!doc) return
    const yText = yTextMapRef.current.get(name)
    if (yText) {
      // Y.Text field: clear and re-insert the text content
      doc.transact(() => {
        yText.delete(0, yText.length)
        if (value) yText.insert(0, String(value))
      })
    } else {
      suppressRef.current.add(name)
      doc.getMap('fields').set(name, value ?? null)
    }
  }, [])

  /** Write ALL field values to the ydoc before save (for version snapshot). */
  const syncAllFieldsToDoc = useCallback((allValues: Record<string, unknown>) => {
    const doc = docRef.current
    if (!doc) return
    const fieldsMap = doc.getMap('fields')
    doc.transact(() => {
      for (const [key, val] of Object.entries(allValues)) fieldsMap.set(key, val ?? null)
    })
  }, [])

  const getYText = useCallback((fieldName: string) => {
    return yTextMapRef.current.get(fieldName) ?? null
  }, [])

  /** Get the Y.Doc instance for creating per-block Y.Text (e.g. content blocks) */
  const getDoc = useCallback(() => {
    return docRef.current ?? null
  }, [])

  return {
    connected,
    synced,
    presences,
    setCollaborativeValue,
    syncAllFieldsToDoc,
    getYText,
    getDoc,
    awareness,
    userName,
    userColor,
  }
}
