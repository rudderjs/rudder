import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getField, subscribeFields } from '@pilotiq/panels'
import type { ResolvedAiAction } from '@pilotiq/panels'
import { useAiChatSafe } from '../agents/AiChatContext.js'
import { registerLexicalEditor } from '../agents/lexicalRegistry.js'
import { usePanelAgentApi } from '../agents/standaloneAgentApiContext.js'
import { AiDropdown } from '../agents/AiDropdown.js'
import type { FieldInputProps } from './types.js'
import { INPUT_CLS } from './types.js'

interface InlineAiAnchorRect {
  left:   number
  top:    number
  right:  number
  bottom: number
}

/** Global registry for textarea collab refs */
const collabTextareaRefs = new Map<string, { current: { setContent(text: string): void } | null }>()

export function getCollabTextareaRef(fieldName: string) {
  return collabTextareaRefs.get(fieldName)?.current ?? null
}

export function TextareaInput({ field, value, onChange, disabled = false, userName, userColor, wsPath, docName }: FieldInputProps) {
  const isDisabled = disabled || field.readonly
  const aiChat = useAiChatSafe()
  const apiCtx = usePanelAgentApi()
  const fieldName = field.name

  const aiActions: ResolvedAiAction[] = Array.isArray(field.ai) ? field.ai : []
  const hasInlineAi = aiActions.length > 0 && !!apiCtx

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

  const editorRef = useRef<{ setContent(text: string): void } | null>(null)
  const nativeTextareaRef = useRef<HTMLTextAreaElement>(null)
  const isCollabPath = !!(field.yjs && wsPath && docName)

  useEffect(() => {
    if (field.yjs) {
      collabTextareaRefs.set(field.name, editorRef)
      return () => { collabTextareaRefs.delete(field.name) }
    }
  }, [field.name, field.yjs])

  // Register the live LexicalEditor instance under this field name so the AI
  // `update_form_state` client tool can dispatch ops via editor.update().
  const onEditorMount = useCallback(
    (editor: Parameters<typeof registerLexicalEditor>[1]) =>
      registerLexicalEditor(fieldName, editor),
    [fieldName],
  )

  // Collaborative textarea — reactively wait for the Lexical component to register.
  const CollabText = useSyncExternalStore(
    subscribeFields,
    () => getField('_lexical:collaborativePlainText') ?? null,
    () => null,
  )

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

  if (CollabText && isCollabPath) {
    return (
      <>
        <CollabText
          value={(value as string) ?? ''}
          onChange={(v: string) => onChange(v)}
          wsPath={wsPath}
          docName={docName}
          fieldName={field.name}
          multiline
          className={INPUT_CLS}
          placeholder={(field.extra?.placeholder as string) ?? ''}
          disabled={isDisabled}
          required={field.required}
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

  // Non-collab plain textarea — no inline AI surface. The field-level `✦`
  // dropdown at the top of the field (rendered by SchemaRenderer) is the
  // only AI trigger.
  return (
    <textarea
      ref={nativeTextareaRef}
      name={field.name}
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      rows={(field.extra?.rows as number) ?? 4}
      required={field.required}
      readOnly={field.readonly}
      disabled={isDisabled}
      className={INPUT_CLS}
      placeholder={(field.extra?.placeholder as string) ?? ''}
    />
  )
}
