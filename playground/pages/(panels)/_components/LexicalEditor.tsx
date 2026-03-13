import { useCallback, useMemo } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { CodeNode } from '@lexical/code'
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'
import { SlashCommandPlugin } from './lexical/SlashCommandPlugin.js'
import { FloatingToolbarPlugin } from './lexical/FloatingToolbarPlugin.js'

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
}

const EDITOR_NODES = [
  HeadingNode, QuoteNode,
  ListNode, ListItemNode,
  LinkNode, CodeNode,
  HorizontalRuleNode,
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
}: Props) {
  const isCollab = !!(yDoc && yDocSynced)

  const initialConfig = useMemo(() => ({
    namespace: fragmentName,
    nodes: [...EDITOR_NODES],
    theme: THEME,
    editable: !disabled,
    editorState: isCollab
      ? null  // CRITICAL: must be null for CollaborationPlugin to hydrate from Y.js
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

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="lexical-editor rounded-lg border border-input bg-background relative">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="prose prose-sm max-w-none p-3 min-h-[200px] outline-none"
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
        <SlashCommandPlugin />
        <FloatingToolbarPlugin />

        {isCollab ? (
          <CollaborationPlugin
            id={fragmentName}
            providerFactory={createProviderFactory(yDoc, awareness, yDocSynced)}
            shouldBootstrap={false}
          />
        ) : (
          <>
            <HistoryPlugin />
            <OnChangePlugin onChange={onChange} />
          </>
        )}

        {isCollab && <OnChangePlugin onChange={onChange} />}
      </div>
      <style>{collabCursorStyles}</style>
    </LexicalComposer>
  )
}

// ── OnChangePlugin ──────────────────────────────────────────

function OnChangePlugin({ onChange }: { onChange: (json: unknown) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      onChange(editorState.toJSON())
    })
  }, [editor, onChange])
  return null
}

// ── Collaboration Provider Factory ──────────────────────────
//
// KEY AWARENESS FIX: @lexical/yjs calls provider.on('sync', cb) to know when
// the Y.Doc is ready. Since our provider is already synced (useCollaborativeForm
// manages the WebSocket), we must:
// 1. Store the 'sync' callback when Lexical registers it
// 2. Fire it immediately (via microtask) since we're already synced
// 3. Support on/off properly so cleanup works

function createProviderFactory(yDoc: any, awareness: any, alreadySynced: boolean) {
  return (id: string, yjsDocMap: Map<string, any>) => {
    // Inject our existing Y.Doc so Lexical uses the shared doc
    yjsDocMap.set(id, yDoc)

    // Track event listeners for proper on/off support
    const listeners = new Map<string, Set<Function>>()

    const provider = {
      // Share awareness from useCollaborativeForm — cursors use existing user identity
      awareness: awareness ?? {
        getLocalState: () => null,
        setLocalState: () => {},
        setLocalStateField: () => {},
        getStates: () => new Map(),
        on: () => {},
        off: () => {},
      },
      connect() {},      // Already connected via our WebSocket provider
      disconnect() {},
      on(type: string, cb: Function) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(cb)

        // If already synced and Lexical is registering a 'sync' listener,
        // fire it on next microtask so Lexical initializes properly
        if (type === 'sync' && alreadySynced) {
          Promise.resolve().then(() => cb(true))
        }
      },
      off(type: string, cb: Function) {
        listeners.get(type)?.delete(cb)
      },
    }

    return provider
  }
}

const collabCursorStyles = `
  .lexical-cursor {
    display: inline;
    position: relative;
    z-index: 10;
  }
  .lexical-cursor-caret {
    display: inline-block;
    width: 2px;
    position: relative;
    z-index: 10;
  }
  .lexical-cursor-name {
    position: absolute;
    top: -1.2em;
    left: -1px;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 3px 3px 3px 0;
    white-space: nowrap;
    color: white;
  }
`
