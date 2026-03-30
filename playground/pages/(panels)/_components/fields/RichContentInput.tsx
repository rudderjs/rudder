'use client'

import { useState, useEffect, type ComponentType } from 'react'
import { getField } from '@boostkit/panels'
import type { FieldInputProps } from './types.js'

export function RichContentInput({ field, value, onChange, disabled = false, userName, userColor, wsPath, docName }: FieldInputProps) {
  const isDisabled = disabled || field.readonly

  // Always start null to avoid SSR/client hydration mismatch — editor registers async on client
  const [RichEditor, setRichEditor] = useState<ComponentType<Record<string, unknown>> | null>(null)
  useEffect(() => {
    if (getField('_lexical:richcontent')) {
      setRichEditor(() => getField('_lexical:richcontent')!)
      return
    }
    const interval = setInterval(() => {
      const comp = getField('_lexical:richcontent')
      if (comp) {
        setRichEditor(() => comp)
        clearInterval(interval)
      }
    }, 50)
    return () => clearInterval(interval)
  }, [])

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
