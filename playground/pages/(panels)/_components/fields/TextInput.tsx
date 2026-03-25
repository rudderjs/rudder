import { useState, useEffect } from 'react'
import { getField } from '@boostkit/panels'
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
    // datetime-local expects "YYYY-MM-DDTHH:mm"
    return d.toISOString().slice(0, 16)
  }
  // date expects "YYYY-MM-DD"
  return d.toISOString().slice(0, 10)
}

export function TextInput({ field, value, onChange, disabled = false, userName, userColor, wsPath, docName }: FieldInputProps) {
  const isDisabled = disabled || field.readonly
  const inputType = typeMap[field.type] ?? 'text'

  const inputValue = (field.type === 'date' || field.type === 'datetime')
    ? formatDateValue(value, field.type)
    : (value as string) ?? ''

  // Collaborative text — only render after client mount to avoid hydration mismatch
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (mounted && (field.type === 'text' || field.type === 'email') && field.yjs && wsPath && docName) {
    const CollabText = getField('collaborativePlainText')
    if (CollabText) {
      return (
        <CollabText
          value={(value as string) ?? ''}
          onChange={(v) => onChange(v)}
          wsPath={wsPath}
          docName={docName}
          fieldName={field.name}
          className={INPUT_CLS}
          placeholder={(field.extra?.placeholder as string) ?? ''}
          disabled={isDisabled}
          required={field.required}
          {...(userName !== undefined ? { userName } : {})}
          {...(userColor !== undefined ? { userColor } : {})}
        />
      )
    }
  }

  return (
    <input
      type={inputType}
      name={field.name}
      value={inputValue}
      onChange={(e) => onChange(e.target.value)}
      required={field.required}
      readOnly={field.readonly}
      disabled={isDisabled}
      placeholder={(field.extra?.placeholder as string) ?? ''}
      className={INPUT_CLS}
    />
  )
}
