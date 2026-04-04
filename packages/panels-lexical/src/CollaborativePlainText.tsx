import { useMemo, useRef, useEffect } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin'
import { LexicalCollaboration } from '@lexical/react/LexicalCollaborationContext'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $createParagraphNode, $createTextNode, KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH, type TextNode } from 'lexical'
import { useYjsCollab } from './hooks/useYjsCollab.js'

// ─── Edit operations for surgical AI edits ──────────────────

export type EditOperation =
  | { type: 'replace'; search: string; replace: string }
  | { type: 'insert_after'; search: string; text: string }
  | { type: 'delete'; search: string }
  | { type: 'update_block'; blockType: string; blockIndex: number; field: string; value: unknown }

/** Shared editor handle exposed via ref. */
export interface EditorHandle {
  setContent(text: string): void
  applyEdits(operations: EditOperation[]): void
  getTextContent(): string
}

/**
 * Apply a single text operation (replace/insert_after/delete) to the first matching TextNode.
 * Must be called inside `editor.update()`. Shared by plain text and rich text editor ref plugins.
 *
 * @param editor — the Lexical editor instance (for scheduling highlight cleanup)
 */
export function applyTextOp(
  op: Extract<EditOperation, { type: 'replace' | 'insert_after' | 'delete' }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any,
  highlightMs = 1500,
) {
  const textNodes = $getRoot().getAllTextNodes()
  for (const node of textNodes) {
    const text = node.getTextContent()
    const idx = text.indexOf(op.search)
    if (idx === -1) continue

    switch (op.type) {
      case 'replace': {
        const parts = node.splitText(idx, idx + op.search.length)
        const target = idx === 0 ? parts[0]! : parts[1]!
        target.setTextContent(op.replace)
        target.setStyle('background-color: rgba(59, 130, 246, 0.15); transition: background-color 1.5s;')
        setTimeout(() => {
          editor.update(() => { try { target.setStyle('') } catch { /* node may have changed */ } })
        }, highlightMs)
        break
      }
      case 'insert_after': {
        const endIdx = idx + op.search.length
        const insertNode = $createTextNode(op.text)
        insertNode.setStyle('background-color: rgba(59, 130, 246, 0.15); transition: background-color 1.5s;')
        if (endIdx < text.length) {
          const parts = node.splitText(endIdx)
          parts[1]!.insertBefore(insertNode)
        } else {
          node.insertAfter(insertNode)
        }
        setTimeout(() => {
          editor.update(() => { try { insertNode.setStyle('') } catch { /* */ } })
        }, highlightMs)
        break
      }
      case 'delete': {
        const parts = node.splitText(idx, idx + op.search.length)
        const target = idx === 0 ? parts[0]! : parts[1]!
        target.remove()
        break
      }
    }
    break // Only first match per operation
  }
}

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
  /** Ref for imperative control (e.g. version restore, AI edits) */
  editorRef?:  React.MutableRefObject<EditorHandle | null>
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
// Exposes imperative handle for version restore and surgical AI edits.

function PlainTextEditorRefPlugin({ editorRef }: { editorRef: React.MutableRefObject<EditorHandle | null> }) {
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

      applyEdits(operations: EditOperation[]) {
        editor.update(() => {
          for (const op of operations) {
            if (op.type === 'update_block') continue // Plain text has no blocks
            applyTextOp(op, editor)
          }
        })
      },

      getTextContent(): string {
        return editor.getEditorState().read(() => $getRoot().getTextContent())
      },
    }
    return () => { editorRef.current = null }
  }, [editor, editorRef])

  return null
}

