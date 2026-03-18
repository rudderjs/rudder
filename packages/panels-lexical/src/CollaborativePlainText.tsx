/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useRef, useState, useEffect } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin'
import { LexicalCollaboration } from '@lexical/react/LexicalCollaborationContext'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $createParagraphNode, $createTextNode, KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH } from 'lexical'

interface Props {
  value:       string
  onChange:    (value: string) => void
  wsPath:      string
  docName:     string
  fieldName:   string
  userName?:   string
  userColor?:  string
  placeholder?: string
  disabled?:   boolean
  required?:   boolean
  className?:  string
  /** If true, renders as a multi-line textarea. If false (default), single-line input. */
  multiline?:  boolean
}

const THEME = {
  paragraph: '',
}

/**
 * A collaborative plain-text field powered by Lexical + Yjs.
 * Each instance creates its own Y.Doc + WebSocket room for isolation.
 *
 * - `multiline=false` (default): behaves like an `<input>` — Enter is blocked.
 * - `multiline=true`: behaves like a `<textarea>` — Enter inserts newlines.
 */
export function CollaborativePlainText({
  value, onChange, wsPath, docName, fieldName,
  userName, userColor, placeholder, disabled, required,
  className, multiline = false,
}: Props) {
  const cursorsContainerRef = useRef<HTMLDivElement>(null)

  // ── Per-field collaborative state ─────────────────────────
  const [collabReady, setCollabReady] = useState(false)
  const [providerSynced, setProviderSynced] = useState(false)
  const collabRef = useRef<{ doc: any; provider: any } | null>(null)

  const fragmentName = `text:${fieldName}`

  useEffect(() => {
    let destroyed = false

    Promise.all([import('yjs'), import('y-websocket')]).then(([Y, ws]) => {
      if (destroyed) return

      const doc = new Y.Doc()
      const wsProto  = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl    = `${wsProto}://${window.location.host}${wsPath}`
      const roomName = `${docName}:${fragmentName}`

      const provider = new ws.WebsocketProvider(wsUrl, roomName, doc, { connect: false })
      provider.awareness.setLocalStateField('user', {
        name:  userName  ?? `User-${Math.floor(Math.random() * 1000)}`,
        color: userColor ?? `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`,
      })

      ;(provider as any).once('synced', () => {
        if (!destroyed) setProviderSynced(true)
      })

      collabRef.current = { doc, provider }
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
  }, [wsPath, docName, fragmentName]) // eslint-disable-line react-hooks/exhaustive-deps

  const providerFactory = useMemo(() => {
    if (!collabReady || !collabRef.current) return undefined
    const { doc, provider } = collabRef.current
    return (_id: string, yjsDocMap: Map<string, any>) => {
      yjsDocMap.set(_id, doc)
      return provider
    }
  }, [collabReady])

  const initialConfig = useMemo(() => ({
    namespace: fragmentName,
    nodes: [],
    theme: THEME,
    editable: !disabled,
    ...(collabReady
      ? { editorState: null }
      : value ? { editorState: () => {
          const root = $getRoot()
          const p = $createParagraphNode()
          p.append($createTextNode(value))
          root.append(p)
        } } : {}),
    onError: (error: Error) => console.error('[CollaborativePlainText]', error),
  }), [fragmentName, disabled, collabReady]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!collabReady) {
    if (multiline) {
      return <textarea className={className} value={value} readOnly placeholder={placeholder} disabled={disabled} />
    }
    return <input type="text" className={className} value={value} readOnly placeholder={placeholder} disabled={disabled} />
  }

  const editorContent = (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative">
        <div ref={cursorsContainerRef} className="cursors-container" />
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              className={className}
              style={multiline ? undefined : { whiteSpace: 'nowrap', overflow: 'hidden' }}
              aria-required={required}
            />
          }
          placeholder={
            placeholder ? (
              <div className="absolute top-0 left-0 px-3 py-2 text-sm text-muted-foreground/50 pointer-events-none">
                {placeholder}
              </div>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <CollaborationPlugin
          id={fragmentName}
          providerFactory={providerFactory as NonNullable<typeof providerFactory>}
          shouldBootstrap={false}
          username={userName ?? ''}
          cursorColor={userColor ?? ''}
          cursorsContainerRef={cursorsContainerRef}
        />
        <OnChangePlugin onChange={onChange} />
        {!multiline && <BlockEnterPlugin />}
        {providerSynced && <SeedPlugin value={value} />}
      </div>
    </LexicalComposer>
  )

  return (
    <LexicalCollaboration>
      {editorContent}
    </LexicalCollaboration>
  )
}

// ── OnChangePlugin ──────────────────────────────────────────
// Extracts plain text from Lexical state and calls onChange.
// Skips remote collaborative changes to avoid re-render cascades.

function OnChangePlugin({ onChange }: { onChange: (value: string) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return
      const text = editorState.read(() => $getRoot().getTextContent())
      onChange(text)
    })
  }, [editor, onChange])
  return null
}

// ── BlockEnterPlugin ────────────────────────────────────────
// Prevents Enter from creating new paragraphs — single-line input behavior.

function BlockEnterPlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => true, // Return true to prevent default (block the enter)
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor])
  return null
}

// ── SeedPlugin ──────────────────────────────────────────────
// Seeds the editor from the database value if the Y.Doc is empty after sync.

function SeedPlugin({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext()
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current || !value) return
    const isEmpty = editor.getEditorState().read(() => !$getRoot().getTextContent().trim())
    if (isEmpty) {
      seeded.current = true
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const p = $createParagraphNode()
        p.append($createTextNode(value))
        root.append(p)
      })
    }
  }, [editor, value])

  return null
}
