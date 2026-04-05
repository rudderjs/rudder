import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { getField, subscribeFields } from '@rudderjs/panels'
import { useAiChatSafe } from '../agents/AiChatContext.js'
import { useNativeSelectionAi } from '../../_hooks/useNativeSelectionAi.js'
import type { FieldInputProps } from './types.js'
import { INPUT_CLS } from './types.js'
/** Global registry for textarea collab refs */
const collabTextareaRefs = new Map<string, { current: { setContent(text: string): void } | null }>()

export function getCollabTextareaRef(fieldName: string) {
  return collabTextareaRefs.get(fieldName)?.current ?? null
}

export function TextareaInput({ field, value, onChange, disabled = false, userName, userColor, wsPath, docName, onAskAi: onAskAiProp }: FieldInputProps) {
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

  const editorRef = useRef<{ setContent(text: string): void } | null>(null)
  // Ref + hook for native textarea Ask AI (must be before any early return)
  const nativeTextareaRef = useRef<HTMLTextAreaElement>(null)
  const isCollabPath = !!(field.yjs && wsPath && docName)
  const nativeAiBtn = useNativeSelectionAi(nativeTextareaRef, !isCollabPath && hasAskAi ? onAskAi : undefined)

  useEffect(() => {
    if (field.yjs) {
      collabTextareaRefs.set(field.name, editorRef)
      return () => { collabTextareaRefs.delete(field.name) }
    }
  }, [field.name, field.yjs])

  // Collaborative textarea — reactively wait for the Lexical component to register.
  const CollabText = useSyncExternalStore(
    subscribeFields,
    () => getField('_lexical:collaborativePlainText') ?? null,
    () => null,
  )

  if (CollabText && isCollabPath) {
    return (
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
        {...(hasAskAi ? { onAskAi } : {})}
      />
    )
  }

  return (
    <>
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
      {nativeAiBtn}
    </>
  )
}
