import { useEffect, useRef, useState, useCallback } from 'react'

interface CollaborativeFormOptions {
  docName:  string
  wsPath:   string
  fields:   { name: string; collaborative?: boolean }[]
  values:   Record<string, unknown>
  setValue:  (name: string, value: unknown) => void
}

interface Presence { name: string; color: string }

/**
 * Connect to a Yjs ydoc via y-websocket, sync collaborative fields
 * bidirectionally with React form state, and provide presence data.
 *
 * Pass `null` to disable (non-versioned resources).
 */
export function useCollaborativeForm(options: CollaborativeFormOptions | null) {
  const [connected, setConnected] = useState(false)
  const [presences, setPresences] = useState<Presence[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docRef      = useRef<any>(null)
  const suppressRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!options) return
    let destroyed = false

    async function connect() {
      const Y = await import('yjs')
      const { WebsocketProvider } = await import('y-websocket')
      if (destroyed) return

      const wsUrl    = `ws://${window.location.host}${options!.wsPath}`
      const doc      = new Y.Doc()
      const provider = new WebsocketProvider(wsUrl, options!.docName, doc)

      docRef.current      = doc
      providerRef.current = provider

      const fieldsMap = doc.getMap('fields')

      // Observe remote changes → update React state
      fieldsMap.observe((event) => {
        event.keysChanged.forEach((key) => {
          if (suppressRef.current.has(key)) { suppressRef.current.delete(key); return }
          const field = options!.fields.find(f => f.name === key)
          if (field?.collaborative) options!.setValue(key, fieldsMap.get(key))
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

      // Seed initial values for collaborative fields from React state
      const collabFields = options!.fields.filter(f => f.collaborative)
      doc.transact(() => {
        for (const f of collabFields) {
          if (!fieldsMap.has(f.name)) fieldsMap.set(f.name, options!.values[f.name] ?? null)
        }
      })
    }

    void connect()
    return () => {
      destroyed = true
      providerRef.current?.destroy()
      docRef.current?.destroy()
      providerRef.current = null
      docRef.current      = null
    }
  }, [options?.docName]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Write a local change to the ydoc (for collaborative fields). */
  const setCollaborativeValue = useCallback((name: string, value: unknown) => {
    const doc = docRef.current
    if (!doc) return
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

  return { connected, presences, setCollaborativeValue, syncAllFieldsToDoc }
}
