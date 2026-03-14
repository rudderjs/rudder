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
  yDoc?:         any | null
  awareness?:    any | null
  yDocSynced?:   boolean
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
  yDoc, awareness, yDocSynced, fragmentName = 'richcontent',
  blocks, userName, userColor,
}: Props) {
  const isCollab = !!(yDoc && yDocSynced)
  const anchorRef = useRef<HTMLDivElement>(null)
  const cursorsContainerRef = useRef<HTMLDivElement>(null)

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

  const initialConfig = useMemo(() => ({
    namespace: fragmentName,
    nodes: [...EDITOR_NODES],
    theme: THEME,
    editable: !disabled,
    editorState: isCollab
      ? null  // CollaborationPlugin hydrates from Y.js; SeedPlugin handles DB fallback
      : (value ? JSON.stringify(value) : undefined),
    onError: (error: Error) => console.error('[LexicalEditor]', error),
  }), [fragmentName, disabled, isCollab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Show loading state while waiting for Y.Doc sync
  if (yDoc && !yDocSynced) {
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

        {isCollab ? (
          <CollaborationPlugin
            id={fragmentName}
            providerFactory={createProviderFactory(yDoc, awareness, yDocSynced)}
            shouldBootstrap={false}
            username={userName}
            cursorColor={userColor}
            cursorsContainerRef={cursorsContainerRef}
          />
        ) : (
          <HistoryPlugin />
        )}

        <OnChangePlugin onChange={onChange} />
        {isCollab && <SeedPlugin value={value} />}

        <DragHandleLoader anchorRef={anchorRef} />
        </div>
      </div>
      <style>{dragHandleStyles}</style>
    </LexicalComposer>
  )

  return (
    <BlockRegistryContext.Provider value={blockRegistry}>
      {isCollab ? (
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

// ── Collaboration Provider Factory ──────────────────────────

function createProviderFactory(yDoc: any, awareness: any, _alreadySynced: boolean) {
  return (id: string, yjsDocMap: Map<string, any>) => {
    yjsDocMap.set(id, yDoc)

    const listeners = new Map<string, Set<Function>>()

    const provider = {
      awareness: awareness ?? {
        getLocalState: () => null,
        setLocalState: () => {},
        setLocalStateField: () => {},
        getStates: () => new Map(),
        on: () => {},
        off: () => {},
      },
      connect() {
        // Called by CollaborationPlugin's useProvider AFTER the
        // observeDeep listener is attached.  Trigger the real WS/IDB
        // connections so content arrives as Y.Doc updates that the
        // observer will catch.
        yDoc.__bk_start_sync?.()

        // Fire 'sync' after a microtask — by this point the observer
        // is attached AND the WS/IDB providers have been started (but
        // their async I/O hasn't completed yet, so the Y.Doc is still
        // empty when 'sync' fires — bootstrap/SeedPlugin handles fallback).
        Promise.resolve().then(() => {
          listeners.get('sync')?.forEach(cb => cb(true))
        })
      },
      disconnect() {},
      on(type: string, cb: Function) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(cb)
      },
      off(type: string, cb: Function) {
        listeners.get(type)?.delete(cb)
      },
    }

    return provider
  }
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
