import { useEffect, useRef, useSyncExternalStore } from 'react'
import { getField, subscribeFields } from '@rudderjs/panels'
import type { FieldInputProps } from './types.js'
import { INPUT_CLS } from './types.js'
/** Global registry for textarea collab refs */
const collabTextareaRefs = new Map<string, { current: { setContent(text: string): void } | null }>()

export function getCollabTextareaRef(fieldName: string) {
  return collabTextareaRefs.get(fieldName)?.current ?? null
}

export function TextareaInput({ field, value, onChange, disabled = false, userName, userColor, wsPath, docName }: FieldInputProps) {
  const isDisabled = disabled || field.readonly

  const editorRef = useRef<{ setContent(text: string): void } | null>(null)

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

  if (CollabText && field.yjs && wsPath && docName) {
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
      />
    )
  }
  return (
    <textarea
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
