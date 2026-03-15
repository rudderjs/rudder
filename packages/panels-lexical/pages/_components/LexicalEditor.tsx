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
import { $getRoot, $getSelection, $isRangeSelection, $parseSerializedNode } from 'lexical'
import { BlockNode, $createBlockNode } from './lexical/BlockNode.js'
import { BlockRegistryContext } from './lexical/BlockNodeComponent.js'
import { SlashMenuOption } from './lexical/SlashCommandPlugin.js'
import type { BlockMeta } from '@boostkit/panels'

interface Props {
  value:         unknown       // Lexical JSON state or null
  onChange:      (json: unknown) => void
  placeholder?:  string
  disabled?:     boolean
  /** WebSocket path for live collaboration (e.g. '/ws-live') */
  wsPath?:       string | null
  /** Base document name — each editor creates room `${docName}:${fragmentName}` */
  docName?:      string | null
  fragmentName?: string
  blocks?:       any[]
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
  const collabRef = useRef<{ doc: any; provider: any } | null>(null)

  useEffect(() => {
    if (!isCollab) return
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

      collabRef.current = { doc, provider }
      setCollabReady(true)
    })

    return () => {
      destroyed = true
      collabRef.current?.provider?.destroy()
      collabRef.current?.doc?.destroy()
      collabRef.current = null
      setCollabReady(false)
    }
  }, [wsPath, docName, fragmentName]) // eslint-disable-line react-hooks/exhaustive-deps

  // Memoize provider factory — must be stable across renders so
  // CollaborationPlugin doesn't disconnect/reconnect on every re-render.
  const providerFactory = useMemo(() => {
    if (!collabReady || !collabRef.current) return undefined
    const { doc, provider } = collabRef.current
    return (_id: string, yjsDocMap: Map<string, any>) => {
      yjsDocMap.set(_id, doc)
      return provider
    }
  }, [collabReady])

  const blockRegistry = useMemo(() => {
    const map = new Map<string, BlockMeta>()
    for (const b of (blocks ?? []) as BlockMeta[]) map.set(b.name, b)
    return map
  }, [blocks])

  const blockSlashItems = useMemo(() => {
    if (!blocks?.length) return undefined
    return (blocks as BlockMeta[]).map(block => new SlashMenuOption(
      block.label || block.name,
      {
        icon: block.icon || '[]',
        description: `Insert ${block.label || block.name}`,
        onSelect: (editor: any) => {
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

  const initialConfig = useMemo(() => ({
    namespace: fragmentName,
    nodes: [...EDITOR_NODES],
    theme: THEME,
    editable: !disabled,
    editorState: collabActive
      ? null  // CollaborationPlugin hydrates from Y.js; SeedPlugin handles DB fallback
      : (value ? JSON.stringify(value) : undefined),
    onError: (error: Error) => console.error('[LexicalEditor]', error),
  }), [fragmentName, disabled, collabActive]) // eslint-disable-line react-hooks/exhaustive-deps

  // Show loading state while waiting for Y.Doc + WS setup
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
            username={userName}
            cursorColor={userColor}
            cursorsContainerRef={cursorsContainerRef}
          />
        ) : (
          <HistoryPlugin />
        )}

        <OnChangePlugin onChange={onChange} />
        {collabActive && <SeedPlugin value={value} />}

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
// Only fires onChange when content actually changed (dirtyElements/dirtyLeaves),
// NOT for selection changes or awareness updates. This prevents the parent form
// from re-rendering on every cursor move, which would reset caret position in
// other controlled inputs.

function OnChangePlugin({ onChange }: { onChange: (json: unknown) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return
      onChange(editorState.toJSON())
    })
  }, [editor, onChange])
  return null
}

// ── SeedPlugin ──────────────────────────────────────────────
// In collaborative mode, the editor starts empty (editorState: null) and
// CollaborationPlugin binds to the Y.XmlFragment. If the Y.Doc is fresh
// (server restart, new session), the fragment is empty. This plugin seeds
// the editor from the database value after CollaborationPlugin initializes.
//
// Uses editor.update() + $parseSerializedNode so mutations go through
// the normal path and trigger syncLexicalUpdateToYjs (the Y.js binding).
// editor.setEditorState() does NOT mark elements dirty, so the binding's
// syncLexicalUpdateToYjs skips the sync (it checks dirtyElements.has('root')).

function SeedPlugin({ value }: { value: unknown }) {
  const [editor] = useLexicalComposerContext()
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current || !value) return
    // Wait for CollaborationPlugin to bind and sync
    const timer = setTimeout(() => {
      if (seeded.current) return
      const isEmpty = editor.getEditorState().read(() => {
        return !$getRoot().getTextContent().trim()
      })
      if (isEmpty) {
        seeded.current = true
        try {
          const serialized = typeof value === 'string' ? JSON.parse(value) : value
          const children = (serialized as any)?.root?.children
          if (Array.isArray(children) && children.length > 0) {
            editor.update(() => {
              const root = $getRoot()
              root.clear()
              for (const child of children) {
                const node = $parseSerializedNode(child)
                root.append(node)
              }
            })
          }
        } catch (e) {
          console.error('[LexicalEditor] SeedPlugin failed:', e)
        }
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [editor, value])

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
