import { useState, useEffect, useRef } from 'react'
import { getField } from '@rudderjs/panels'
import type { FieldInputProps } from './types.js'
import { INPUT_CLS } from './types.js'

const typeMap: Record<string, string> = {
  text:     'text',
  email:    'email',
  number:   'number',
  date:     'date',
  datetime: 'datetime-local',
}

function formatDateValue(v: unknown, fieldType: string): string {
  if (!v) return ''
  const d = new Date(v as string)
  if (isNaN(d.getTime())) return String(v)
  if (fieldType === 'datetime') {
    return d.toISOString().slice(0, 16)
  }
  return d.toISOString().slice(0, 10)
}

/** Global registry of collaborative text editor refs for version restore. */
const collabTextRefs = new Map<string, { current: { setContent(text: string): void } | null }>()

/** Get the editor ref for a collaborative text field (used by version restore). */
export function getCollabTextRef(fieldName: string) {
  return collabTextRefs.get(fieldName)?.current ?? null
}

export function TextInput({ field, value, onChange, disabled = false, userName, userColor, wsPath, docName }: FieldInputProps) {
  const isDisabled = disabled || field.readonly
  const inputType = typeMap[field.type] ?? 'text'

  const inputValue = (field.type === 'date' || field.type === 'datetime')
    ? formatDateValue(value, field.type)
    : (value as string) ?? ''

  // Editor ref for imperative control (version restore)
  const editorRef = useRef<{ setContent(text: string): void } | null>(null)

  useEffect(() => {
    if (field.yjs) {
      collabTextRefs.set(field.name, editorRef)
      return () => { collabTextRefs.delete(field.name) }
    }
  }, [field.name, field.yjs])

  // Collaborative text — poll until the Lexical component registers (same pattern as RichContentInput).
  // Avoids rendering the plain <input> fallback with a stale DB value when Yjs has the real content.
  const [CollabText, setCollabText] = useState<ReturnType<typeof getField>>(null)
  useEffect(() => {
    if (!(field.type === 'text' || field.type === 'email') || !field.yjs || !wsPath || !docName) return
    const existing = getField('_lexical:collaborativePlainText')
    if (existing) { setCollabText(() => existing); return }
    const interval = setInterval(() => {
      const comp = getField('_lexical:collaborativePlainText')
      if (comp) { setCollabText(() => comp); clearInterval(interval) }
    }, 50)
    return () => clearInterval(interval)
  }, [field.type, field.yjs, wsPath, docName]) // eslint-disable-line react-hooks/exhaustive-deps

  if (CollabText && field.yjs && wsPath && docName) {
    return (
      <CollabText
        value={(value as string) ?? ''}
        onChange={(v: unknown) => onChange(v)}
        wsPath={wsPath}
        docName={docName}
        fieldName={field.name}
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
    <input
      type={inputType}
      name={field.name}
      value={inputValue}
      onChange={(e) => onChange(field.type === 'number' ? e.target.valueAsNumber : e.target.value)}
      required={field.required}
      readOnly={field.readonly}
      disabled={isDisabled}
      placeholder={(field.extra?.placeholder as string) ?? ''}
      className={INPUT_CLS}
    />
  )
}
