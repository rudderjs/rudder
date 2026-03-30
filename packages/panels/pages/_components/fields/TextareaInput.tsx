import { useState, useEffect, useRef } from 'react'
import { getField } from '@boostkit/panels'
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

  // Collaborative textarea — only render after client mount to avoid hydration mismatch
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (mounted && field.yjs && wsPath && docName) {
    const CollabText = getField('_lexical:collaborativePlainText')
    if (CollabText) {
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
