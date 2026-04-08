'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { getField, subscribeFields } from '@rudderjs/panels'
import { useAiChatSafe } from '../agents/AiChatContext.js'
import { registerLexicalEditor } from '../agents/lexicalRegistry.js'
import type { FieldInputProps } from './types.js'

/** Global registry of editor refs for version restore + AI text extraction. Keyed by field name. */
const editorRefs = new Map<string, { current: { setContent(json: unknown): void; getTextContent?(): string } | null }>()

/** Get the editor ref for a richcontent field (used by version restore + AI). */
export function getRichContentRef(fieldName: string) {
  return editorRefs.get(fieldName)?.current ?? null
}

export function RichContentInput({ field, value, onChange, disabled = false, userName, userColor, wsPath, docName, onAskAi: onAskAiProp }: FieldInputProps) {
  const isDisabled = disabled || field.readonly
  const aiChat = useAiChatSafe()
  const fieldName = field.name

  const onAskAi = useCallback((text: string) => {
    if (onAskAiProp) {
      onAskAiProp(text)
    } else if (aiChat) {
      aiChat.setSelection({ field: fieldName, text })
      aiChat.setOpen(true)
    }
  }, [onAskAiProp, aiChat, fieldName])

  const hasAskAi = !!(onAskAiProp || aiChat)

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

  if (RichEditor) {
    return (
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
        {...(hasAskAi ? { onAskAi } : {})}
      />
    )
  }

  // Fallback: shown during SSR and while waiting for the editor to register
  return (
    <div className="min-h-[200px] rounded-lg border border-input bg-background p-3 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
      Loading editor…
    </div>
  )
}
