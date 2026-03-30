import { useMemo, useRef, useEffect } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin'
import { LexicalCollaboration } from '@lexical/react/LexicalCollaborationContext'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $createParagraphNode, $createTextNode, KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH } from 'lexical'
import { useYjsCollab } from './hooks/useYjsCollab.js'

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
  /** Ref for imperative control (e.g. version restore) */
  editorRef?:  React.MutableRefObject<{ setContent(text: string): void } | null>
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
  className, multiline = false, editorRef,
}: Props) {
  const cursorsContainerRef = useRef<HTMLDivElement>(null)
  const fragmentName = `text:${fieldName}`

  // ── Collaborative state (shared hook) ──
  const { collabReady, providerSynced, collabRef, providerFactory } = useYjsCollab({
    wsPath, docName, fragmentName, userName, userColor,
  })

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
        {providerSynced && <SeedPlugin value={value} yjsRef={collabRef} />}
        {editorRef && <PlainTextEditorRefPlugin editorRef={editorRef} />}
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
// Compares with previous value to avoid unnecessary re-renders.

function OnChangePlugin({ onChange }: { onChange: (value: string) => void }) {
  const [editor] = useLexicalComposerContext()
  const prevRef = useRef('')
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      const text = editorState.read(() => $getRoot().getTextContent())
      if (text !== prevRef.current) {
        prevRef.current = text
        onChange(text)
      }
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
// Seeds the editor from DB value ONLY when the Y.Doc is empty after sync.
// Checks Y.Doc state vector directly (synchronous, no race with CollaborationPlugin).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SeedPlugin({ value, yjsRef }: { value: string; yjsRef: React.RefObject<{ doc: any; Y: any } | null> }) {
  const [editor] = useLexicalComposerContext()
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current || !value) return
    seeded.current = true

    // Check if Y.Doc already has meaningful text content
    const yjs = yjsRef.current
    if (yjs) {
      const root = yjs.doc.get('root', yjs.Y.XmlText)
      if (root && root.length > 0) return // Y.Doc has content — CollaborationPlugin will render it
    }

    // Y.Doc is empty — seed from DB value, with retry for race with CollaborationPlugin
    let attempts = 0
    const doSeed = () => {
      if (attempts++ > 5) return
      editor.update(() => {
        const root = $getRoot()
        if (root.getTextContent().trim() !== '') return // content exists, stop
        root.clear()
        const p = $createParagraphNode()
        p.append($createTextNode(value))
        root.append(p)
      })
      setTimeout(doSeed, attempts * 200)
    }
    doSeed()
  }, [editor, value, yjsRef])

  return null
}

// ── PlainTextEditorRefPlugin ──────────────────────────────
// Exposes imperative setContent for version restore.

function PlainTextEditorRefPlugin({ editorRef }: { editorRef: React.MutableRefObject<{ setContent(text: string): void } | null> }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editorRef.current = {
      setContent(text: string) {
        editor.update(() => {
          const root = $getRoot()
          root.clear()
          const p = $createParagraphNode()
          p.append($createTextNode(text))
          root.append(p)
        })
      },
    }
    return () => { editorRef.current = null }
  }, [editor, editorRef])

  return null
}

