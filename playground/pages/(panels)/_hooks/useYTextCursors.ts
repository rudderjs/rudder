import { useEffect, useState, useCallback, useRef } from 'react'

interface RemoteCursor {
  clientId:  number
  name:      string
  color:     string
  anchor:    number
  focus:     number
  fieldName: string
}

interface UseYTextCursorsOptions {
  yText:      any | null
  awareness:  any | null
  fieldName:  string
}

export function useYTextCursors({ yText, awareness, fieldName }: UseYTextCursorsOptions) {
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([])
  const yRef = useRef(yText)
  const prevCursorsRef = useRef<string>('[]')
  yRef.current = yText

  const broadcastCursor = useCallback((anchor: number, focus: number) => {
    if (!awareness || !yRef.current) return
    try {
      const Y = (window as any).__yjs
      if (!Y) return
      const anchorPos = Y.createRelativePositionFromTypeIndex(yRef.current, anchor)
      const focusPos  = Y.createRelativePositionFromTypeIndex(yRef.current, focus)
      awareness.setLocalStateField('cursor', {
        fieldName,
        anchor: Y.relativePositionToJSON(anchorPos),
        focus:  Y.relativePositionToJSON(focusPos),
      })
    } catch {
      // Ignore
    }
  }, [awareness, fieldName])

  const clearCursor = useCallback(() => {
    if (!awareness) return
    awareness.setLocalStateField('cursor', null)
  }, [awareness])

  useEffect(() => {
    if (!awareness || !yText) return

    let Y: any = null
    import('yjs').then(mod => {
      Y = mod;
      (window as any).__yjs = mod
    })

    function handleChange() {
      if (!Y || !yText) return
      const doc = yText.doc
      if (!doc) return

      const cursors: RemoteCursor[] = []
      const localId = awareness.clientID

      awareness.getStates().forEach((state: any, clientId: number) => {
        if (clientId === localId) return
        if (!state.cursor || state.cursor.fieldName !== fieldName) return
        if (!state.user) return

        try {
          const anchorAbs = Y.createAbsolutePositionFromRelativePosition(
            Y.createRelativePositionFromJSON(state.cursor.anchor),
            doc,
          )
          const focusAbs = Y.createAbsolutePositionFromRelativePosition(
            Y.createRelativePositionFromJSON(state.cursor.focus),
            doc,
          )
          if (anchorAbs && focusAbs) {
            cursors.push({
              clientId,
              name:      state.user.name,
              color:     state.user.color,
              anchor:    anchorAbs.index,
              focus:     focusAbs.index,
              fieldName,
            })
          }
        } catch {
          // Stale relative position
        }
      })

      // Only re-render if cursors actually changed — avoids resetting
      // native input caret on unrelated awareness updates (e.g. Lexical cursor)
      const key = JSON.stringify(cursors)
      if (key !== prevCursorsRef.current) {
        prevCursorsRef.current = key
        setRemoteCursors(cursors)
      }
    }

    awareness.on('change', handleChange)
    yText.observe(handleChange)

    return () => {
      awareness.off('change', handleChange)
      yText.unobserve(handleChange)
    }
  }, [awareness, yText, fieldName])

  return { remoteCursors, broadcastCursor, clearCursor }
}
