import { useMemo, useRef, useState } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin'
import { LexicalCollaboration } from '@lexical/react/LexicalCollaborationContext'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { CodeNode } from '@lexical/code'
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'
import { SlashCommandPlugin } from './lexical/SlashCommandPlugin.js'
import { FloatingToolbarPlugin } from './lexical/FloatingToolbarPlugin.js'
import { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin'
import { $getRoot, $getSelection, $isRangeSelection, $parseSerializedNode, type LexicalEditor as LexicalEditorType, type SerializedLexicalNode } from 'lexical'
import { BlockNode, $createBlockNode } from './lexical/BlockNode.js'
import { BlockRegistryContext } from './lexical/BlockNodeComponent.js'
import { SlashMenuOption } from './lexical/SlashCommandPlugin.js'
import type { BlockMeta } from '@boostkit/panels'

// Minimal structural interface for a Yjs WebSocket provider.
// y-websocket's own TypeScript types are incomplete (missing .once, .destroy),
// so we define what we actually use rather than importing the class type directly.
interface YjsProvider {
  awareness: { setLocalStateField(field: string, state: Record<string, unknown>): void }
  once(event: string, callback: () => void): void
  destroy(): void
}

export interface Props {
  value:         unknown       // Lexical JSON state or null
  onChange:      (json: unknown) => void
  placeholder?:  string
  disabled?:     boolean
  /** WebSocket path for live collaboration (e.g. '/ws-live') */
  wsPath?:       string | null
  /** Base document name — each editor creates room `${docName}:${fragmentName}` */
  docName?:      string | null
  fragmentName?: string
  blocks?:       BlockMeta[]
  /** Stable user identity — passed to CollaborationPlugin so Lexical cursors match input/textarea cursors. */
  userName?:     string
  userColor?:    string
}

const EDITOR_NODES = [
  HeadingNode, QuoteNode,
  ListNode, ListItemNode,
  LinkNode, CodeNode,
  HorizontalRuleNode,
  BlockNode,
]

const THEME = {
  paragraph: 'mb-1',
  heading: {
    h1: 'text-3xl font-bold mb-2',
    h2: 'text-2xl font-semibold mb-2',
    h3: 'text-xl font-semibold mb-1',
  },
  list: {
    ul: 'list-disc ml-6 mb-2',
    ol: 'list-decimal ml-6 mb-2',
    listitem: 'mb-0.5',
  },
  quote: 'border-l-4 border-muted-foreground/30 pl-4 italic mb-2',
  code: 'bg-muted rounded px-1 py-0.5 font-mono text-sm',
  link: 'text-primary underline',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    code: 'bg-muted rounded px-1 py-0.5 font-mono text-sm',
  },
}

export function LexicalEditor({
  value, onChange, placeholder, disabled,
  wsPath, docName, fragmentName = 'richcontent',
  blocks, userName, userColor,
}: Props) {
  const isCollab = !!(wsPath && docName)
  const anchorRef = useRef<HTMLDivElement>(null)
  const cursorsContainerRef = useRef<HTMLDivElement>(null)

  // ── Per-editor collaborative state ─────────────────────────
  // Each LexicalEditor instance creates its own Y.Doc + WebSocket connection
  // because Lexical's createBinding hardcodes doc.get('root', XmlText) —
  // multiple editors sharing one Y.Doc would bind to the same fragment.
  const [collabReady, setCollabReady] = useState(false)
  const [providerSynced, setProviderSynced] = useState(false)
  const collabRef = useRef<{ doc: import('yjs').Doc; provider: YjsProvider; Y: typeof import('yjs') } | null>(null)

  useEffect(() => {
    if (!isCollab) return
    let destroyed = false

    Promise.all([import('yjs'), import('y-websocket')]).then(([Y, ws]) => {
      if (destroyed) return

      const doc = new Y.Doc()
      const wsProto  = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl    = `${wsProto}://${window.location.host}${wsPath}`
      const roomName = `${docName}:${fragmentName}`

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- y-websocket CJS interop: TypeScript resolves it as { default } but runtime exposes WebsocketProvider directly
      const provider = new (ws as any).WebsocketProvider(wsUrl, roomName, doc, { connect: false }) as YjsProvider
      provider.awareness.setLocalStateField('user', {
        name:  userName  ?? `User-${Math.floor(Math.random() * 1000)}`,
        color: userColor ?? `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`,
      })

      // Mark synced after initial server handshake completes
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
  }, [wsPath, docName, fragmentName]) // eslint-disable-line react-hooks/exhaustive-deps

  // Memoize provider factory — must be stable across renders so
  // CollaborationPlugin doesn't disconnect/reconnect on every re-render.
  const providerFactory = useMemo(() => {
    if (!collabReady || !collabRef.current) return undefined
    const { doc, provider } = collabRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lexical's ProviderFactory signature uses Map<string, any> internally
    return (_id: string, yjsDocMap: Map<string, any>) => {
      yjsDocMap.set(_id, doc)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cast to satisfy Lexical's Provider type which requires awareness/connect/disconnect/on/off
      return provider as unknown as any
    }
  }, [collabReady])

  const blockRegistry = useMemo(() => {
    const map = new Map<string, BlockMeta>()
    for (const b of (blocks ?? [])) map.set(b.name, b)
    return map
  }, [blocks])

  const blockSlashItems = useMemo(() => {
    if (!blocks?.length) return undefined
    return (blocks ?? []).map(block => new SlashMenuOption(
      block.label || block.name,
      {
        icon: block.icon || '[]',
        description: `Insert ${block.label || block.name}`,
        onSelect: (editor: LexicalEditorType) => {
          editor.update(() => {
            const sel = $getSelection()
            if ($isRangeSelection(sel)) {
              sel.insertNodes([$createBlockNode(block.name)])
            }
          })
        },
      },
    ))
  }, [blocks])

  const collabActive = isCollab && collabReady && !!providerFactory

  // Match CollaborativePlainText pattern exactly:
  // useMemo with collabReady dependency so LexicalComposer mounts fresh when collab is ready
  const initialConfig = useMemo(() => ({
    namespace: fragmentName,
    nodes: [...EDITOR_NODES],
    theme: THEME,
    editable: !disabled,
    ...(collabReady
      ? { editorState: null }
      : (value && typeof value === 'object' && 'root' in (value as Record<string, unknown>))
        ? { editorState: JSON.stringify(value) }
        : {}),
    onError: (error: Error) => console.error('[LexicalEditor]', error),
  }), [fragmentName, disabled, collabReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // Show loading state while waiting for Y.Doc + WS setup (same pattern as CollaborativePlainText)
  if (isCollab && !collabReady) {
    return (
      <div className="min-h-[200px] rounded-lg border border-input bg-background p-3 flex items-center justify-center text-sm text-muted-foreground">
        Connecting…
      </div>
    )
  }

  const editorContent = (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="lexical-editor rounded-lg border border-input bg-background relative">
        <div ref={anchorRef} className="relative">
        <div ref={cursorsContainerRef} className="cursors-container" />
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="ContentEditable__root prose prose-sm max-w-none p-3 pl-10 min-h-[200px] outline-none"
            />
          }
          placeholder={
            <div className="absolute top-3 left-3 text-muted-foreground/50 pointer-events-none text-sm">
              {placeholder ?? 'Type "/" for commands…'}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ListPlugin />
        <SlashCommandPlugin extraItems={blockSlashItems} />
        <FloatingToolbarPlugin />

        {collabActive ? (
          <CollaborationPlugin
            id={fragmentName}
            providerFactory={providerFactory}
            shouldBootstrap={false}
            username={userName ?? ''}
            cursorColor={userColor ?? ''}
            cursorsContainerRef={cursorsContainerRef}
          />
        ) : (
          <HistoryPlugin />
        )}

        <OnChangePlugin onChange={onChange} />
        {collabActive && providerSynced && <SeedPlugin value={value} yjsRef={collabRef} />}

        <DragHandleLoader anchorRef={anchorRef} />
        </div>
      </div>
      <style>{dragHandleStyles}</style>
    </LexicalComposer>
  )

  return (
    <BlockRegistryContext.Provider value={blockRegistry}>
      {collabActive ? (
        <LexicalCollaboration>{editorContent}</LexicalCollaboration>
      ) : (
        editorContent
      )}
    </BlockRegistryContext.Provider>
  )
}

// ── DragHandleLoader ────────────────────────────────────────

function DragHandleLoader({ anchorRef }: { anchorRef: React.RefObject<HTMLDivElement | null> }) {
  const menuRef = useRef<HTMLDivElement>(null)
  const targetLineRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
   
  if (!mounted || !anchorRef.current) return null

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchorRef.current}
      menuRef={menuRef}
      targetLineRef={targetLineRef}
      menuComponent={
        <div ref={menuRef} className="draggable-block-menu">
          <div className="w-4 h-4 flex items-center justify-center opacity-30 hover:opacity-100 cursor-grab">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <circle cx="4" cy="3" r="1" /><circle cx="8" cy="3" r="1" />
              <circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" />
              <circle cx="4" cy="9" r="1" /><circle cx="8" cy="9" r="1" />
            </svg>
          </div>
        </div>
      }
      targetLineComponent={
        <div ref={targetLineRef} className="draggable-block-target-line" />
      }
      isOnMenu={(el) => !!el.closest('.draggable-block-menu')}
    />
  )
}

// ── OnChangePlugin ──────────────────────────────────────────
// Fires onChange when editor content changes. Compares serialized state to
// avoid re-renders on selection changes and awareness updates.

function OnChangePlugin({ onChange }: { onChange: (json: unknown) => void }) {
  const [editor] = useLexicalComposerContext()
  const prevRef = useRef('')
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      const json = editorState.toJSON()
      const serialized = JSON.stringify(json)
      if (serialized !== prevRef.current) {
        prevRef.current = serialized
        onChange(json)
      }
    })
  }, [editor, onChange])
  return null
}

// ── SeedPlugin ──────────────────────────────────────────────
// Seeds the editor from DB value ONLY when the Y.Doc is empty after sync.
// Checks Y.Doc state vector directly (synchronous, no race with CollaborationPlugin).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SeedPlugin({ value, yjsRef }: { value: unknown; yjsRef: React.RefObject<{ doc: any; Y: any } | null> }) {
  const [editor] = useLexicalComposerContext()
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current || !value) return
    seeded.current = true

    // Check Y.Doc state vector — if > 1, the doc has content from server sync
    const yjs = yjsRef.current
    if (yjs) {
      const sv = yjs.Y.encodeStateVector(yjs.doc)
      if (sv.length > 1) return // Y.Doc has content — CollaborationPlugin will render it
    }

    // Y.Doc is empty (fresh room) — seed from DB value
    try {
      const serialized = typeof value === 'string' ? JSON.parse(value) : value
      const children = (serialized as { root?: { children?: unknown[] } })?.root?.children
      if (Array.isArray(children) && children.length > 0) {
        editor.update(() => {
          const root = $getRoot()
          root.clear()
          for (const child of children) {
            const node = $parseSerializedNode(child as SerializedLexicalNode)
            root.append(node)
          }
        })
      }
    } catch (e) {
      console.error('[LexicalEditor] SeedPlugin failed:', e)
    }
  }, [editor, value, yjsRef])

  return null
}

const dragHandleStyles = `
  .draggable-block-menu {
    position: absolute;
    left: 2px;
    top: 0;
    cursor: grab;
    opacity: 0;
    transition: opacity 0.15s;
    padding: 2px;
    border-radius: 4px;
    will-change: transform;
  }
  .draggable-block-menu:hover,
  .draggable-block-menu:active {
    opacity: 1;
  }
  .draggable-block-target-line {
    position: absolute;
    left: 0;
    top: 0;
    height: 4px;
    background: var(--primary);
    border-radius: 2px;
    pointer-events: none;
    opacity: 0;
    z-index: 5;
    will-change: transform;
  }
`
