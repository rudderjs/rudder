import { getField } from '@boostkit/panels'
import type { FieldInputProps } from './types.js'
import { INPUT_CLS } from './types.js'

export function TextareaInput({ field, value, onChange, disabled = false, userName, userColor, wsPath, docName }: FieldInputProps) {
  const isDisabled = disabled || field.readonly

  if (field.yjs && wsPath && docName) {
    const CollabText = getField('collaborativePlainText')
    if (CollabText) {
      return (
        <CollabText
          value={(value as string) ?? ''}
          onChange={(v) => onChange(v)}
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
    />
  )
}
