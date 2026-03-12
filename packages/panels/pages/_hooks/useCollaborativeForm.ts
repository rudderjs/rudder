import { useEffect, useRef, useState, useCallback } from 'react'

interface CollaborativeField {
  name:          string
  collaborative?: boolean
  /** Set to true for text/textarea/content fields that should use Y.Text for character-level sync */
  textField?:    boolean
}

interface CollaborativeFormOptions {
  docName:  string
  wsPath:   string
  fields:   CollaborativeField[]
  values:   Record<string, unknown>
  setValue:  (name: string, value: unknown) => void
}

interface Presence { name: string; color: string }

interface CollaborativeFormReturn {
  connected:             boolean
  presences:             Presence[]
  setCollaborativeValue: (name: string, value: unknown) => void
  syncAllFieldsToDoc:    (allValues: Record<string, unknown>) => void
  /** Get Y.Text instance for a text field. Returns null if not connected or field is not a text field. */
  getYText:              (fieldName: string) => any | null
  /** Get the awareness instance. Returns null if not connected. */
  awareness:             any | null
}

/**
 * Connect to a Yjs ydoc via y-websocket, sync collaborative fields
 * bidirectionally with React form state, and provide presence data.
 *
 * Text fields (textField: true) use Y.Text for character-level CRDT.
 * Other fields use Y.Map for opaque value sync.
 *
 * Pass `null` to disable (non-versioned resources).
 */
export function useCollaborativeForm(options: CollaborativeFormOptions | null): CollaborativeFormReturn {
  const [connected, setConnected] = useState(false)
  const [presences, setPresences] = useState<Presence[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providerRef  = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docRef       = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const awarenessRef = useRef<any>(null)
  const suppressRef  = useRef<Set<string>>(new Set())
  /** Map of fieldName → Y.Text for text fields */
  const yTextMapRef  = useRef<Map<string, any>>(new Map())

  useEffect(() => {
    if (!options) return
    let destroyed = false

    async function connect() {
      const Y = await import('yjs')
      const { WebsocketProvider } = await import('y-websocket')
      if (destroyed) return

      const wsProto  = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl    = `${wsProto}://${window.location.host}${options!.wsPath}`
      const doc      = new Y.Doc()
      const provider = new WebsocketProvider(wsUrl, options!.docName, doc)

      docRef.current      = doc
      providerRef.current = provider
      awarenessRef.current = provider.awareness

      const fieldsMap  = doc.getMap('fields')
      const textFields = options!.fields.filter(f => f.collaborative && f.textField)
      const mapFields  = options!.fields.filter(f => f.collaborative && !f.textField)

      // Create Y.Text instances for text fields
      const yTexts = new Map<string, any>()
      for (const f of textFields) {
        const yText = doc.getText(`field:${f.name}`)
        yTexts.set(f.name, yText)
      }
      yTextMapRef.current = yTexts

      // Seed initial text content
      doc.transact(() => {
        for (const f of textFields) {
          const yText = yTexts.get(f.name)!
          const initVal = String(options!.values[f.name] ?? '')
          if (yText.length === 0 && initVal) {
            yText.insert(0, initVal)
          }
        }
        // Seed non-text collaborative fields
        for (const f of mapFields) {
          if (!fieldsMap.has(f.name)) fieldsMap.set(f.name, options!.values[f.name] ?? null)
        }
      })

      // Observe Y.Text changes → update React state
      for (const f of textFields) {
        const yText = yTexts.get(f.name)!
        yText.observe(() => {
          if (suppressRef.current.has(f.name)) {
            suppressRef.current.delete(f.name)
            return
          }
          options!.setValue(f.name, yText.toString())
        })
      }

      // Observe Y.Map changes for non-text fields → update React state
      fieldsMap.observe((event) => {
        event.keysChanged.forEach((key) => {
          if (suppressRef.current.has(key)) { suppressRef.current.delete(key); return }
          const field = mapFields.find(f => f.name === key)
          if (field) options!.setValue(key, fieldsMap.get(key))
        })
      })

      // Connection status
      provider.on('status', ({ status }: { status: string }) => {
        setConnected(status === 'connected')
      })

      // Presence
      const userName  = `User-${Math.floor(Math.random() * 1000)}`
      const userColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`
      provider.awareness.setLocalStateField('user', { name: userName, color: userColor })

      const syncPresences = () => {
        const states = [...provider.awareness.getStates().values()] as { user?: Presence }[]
        setPresences(states.flatMap(s => s.user ? [s.user] : []))
      }
      syncPresences()
      provider.awareness.on('change', syncPresences)
    }

    void connect()
    return () => {
      destroyed = true
      providerRef.current?.destroy()
      docRef.current?.destroy()
      providerRef.current  = null
      docRef.current       = null
      awarenessRef.current = null
      yTextMapRef.current  = new Map()
    }
  }, [options?.docName]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Write a local change to the ydoc (for non-text collaborative fields). */
  const setCollaborativeValue = useCallback((name: string, value: unknown) => {
    const doc = docRef.current
    if (!doc) return
    // For text fields, use applyDelta via the component — don't set on map
    if (yTextMapRef.current.has(name)) return
    suppressRef.current.add(name)
    doc.getMap('fields').set(name, value ?? null)
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

  return {
    connected,
    presences,
    setCollaborativeValue,
    syncAllFieldsToDoc,
    getYText,
    awareness: awarenessRef.current,
  }
}
