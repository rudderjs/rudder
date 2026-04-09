'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getField, subscribeFields } from '@rudderjs/panels'
import type { ResolvedAiAction } from '@rudderjs/panels'
import { useAiChatSafe } from '../agents/AiChatContext.js'
import { registerLexicalEditor } from '../agents/lexicalRegistry.js'
import { usePanelAgentApi } from '../agents/standaloneAgentApiContext.js'
import { AiDropdown } from '../agents/AiDropdown.js'
import type { FieldInputProps } from './types.js'

/**
 * Anchor rect emitted by the inline `✦` button in panels-lexical surfaces
 * (`FloatingToolbarPlugin` for richcontent, `SelectionAiPlugin` for collab
 * plain text). The field input renders an `AiDropdown` in `fixed` mode at
 * these coordinates so the menu sits just below the trigger button.
 */
interface InlineAiAnchorRect {
  left:   number
  top:    number
  right:  number
  bottom: number
}

/** Global registry of editor refs for version restore + AI text extraction. Keyed by field name. */
const editorRefs = new Map<string, { current: { setContent(json: unknown): void; getTextContent?(): string } | null }>()

/** Get the editor ref for a richcontent field (used by version restore + AI). */
export function getRichContentRef(fieldName: string) {
  return editorRefs.get(fieldName)?.current ?? null
}

export function RichContentInput({ field, value, onChange, disabled = false, userName, userColor, wsPath, docName }: FieldInputProps) {
  const isDisabled = disabled || field.readonly
  const aiChat = useAiChatSafe()
  const apiCtx = usePanelAgentApi()
  const fieldName = field.name

  const aiActions: ResolvedAiAction[] = Array.isArray(field.ai) ? field.ai : []
  const hasInlineAi = aiActions.length > 0 && !!apiCtx

  // Inline-trigger menu state. Captured at the moment the user clicks the
  // floating `✦` in the formatting toolbar; passed to AiDropdown in `fixed`
  // mode so the menu anchors to the button's bounding rect. Frozen for the
  // dropdown's lifetime so subsequent selection changes don't blink the
  // header or shift the menu.
  const [menu, setMenu] = useState<{ text: string; rect: InlineAiAnchorRect } | null>(null)

  const onSelectionAction = useCallback((text: string, rect: InlineAiAnchorRect) => {
    setMenu({ text, rect })
  }, [])

  const onAskChat = useCallback((text: string) => {
    if (aiChat) {
      aiChat.setSelection({ field: fieldName, text })
      aiChat.setOpen(true)
    }
  }, [aiChat, fieldName])

  // Editor ref for imperative control (version restore)
  const editorRef = useRef<{ setContent(json: unknown): void } | null>(null)

  // Register/unregister in global registry
  useEffect(() => {
    editorRefs.set(field.name, editorRef)
    return () => { editorRefs.delete(field.name) }
  }, [field.name])

  // Register the live LexicalEditor instance under this field name so the AI
  // `update_form_state` client tool can dispatch ops via editor.update().
  // Stable across renders so onEditorMount itself doesn't re-fire on parent
  // re-renders, only when the editor instance actually changes.
  const onEditorMount = useCallback(
    (editor: Parameters<typeof registerLexicalEditor>[1]) =>
      registerLexicalEditor(fieldName, editor),
    [fieldName],
  )

  // Reactively wait for the Lexical rich-text component to register.
  const RichEditor = useSyncExternalStore(
    subscribeFields,
    () => getField('_lexical:richcontent') ?? null,
    () => null, // SSR snapshot — never render editor on server
  )

  // Render AiDropdown in fixed mode anchored to the floating button rect.
  // The dropdown owns its own state (selection, prompt, useAgentRun); we
  // just hand it the captured selection text + position.
  const dropdownEl = menu && apiCtx && (
    <AiDropdown
      fieldName={fieldName}
      actions={aiActions}
      apiBase={apiCtx.apiBase}
      resourceSlug={apiCtx.resourceSlug}
      recordId={apiCtx.recordId}
      selection={{ text: menu.text }}
      position={{ mode: 'fixed', left: menu.rect.left, top: menu.rect.bottom + 4 }}
      onClose={() => setMenu(null)}
    />
  )

  if (RichEditor) {
    return (
      <>
        <RichEditor
          value={value || undefined}
          onChange={onChange}
          {...((field.extra?.placeholder as string | undefined) !== undefined ? { placeholder: field.extra?.placeholder as string } : {})}
          disabled={isDisabled}
          wsPath={field.yjs ? (wsPath ?? null) : null}
          docName={field.yjs ? (docName ?? null) : null}
          fragmentName={`richcontent:${field.name}`}
          {...(Array.isArray(field.extra?.['blocks']) ? { blocks: field.extra['blocks'] as unknown[] } : {})}
          {...(field.extra?.['toolbar'] !== undefined ? { toolbar: field.extra['toolbar'] } : {})}
          {...(field.extra?.['slashCommand'] !== undefined ? { slashCommand: field.extra['slashCommand'] } : {})}
          {...(userName !== undefined ? { userName } : {})}
          {...(userColor !== undefined ? { userColor } : {})}
          editorRef={editorRef}
          onEditorMount={onEditorMount}
          {...(hasInlineAi ? { onSelectionAction } : {})}
          {...(aiChat      ? { onAskChat }         : {})}
        />
        {dropdownEl}
      </>
    )
  }

  // Fallback: shown during SSR and while waiting for the editor to register
  return (
    <div className="min-h-[200px] rounded-lg border border-input bg-background p-3 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
      Loading editor…
    </div>
  )
}
