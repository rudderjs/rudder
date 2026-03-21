'use client'

import { useState, useEffect } from 'react'
import { editorRegistry } from '@boostkit/panels'
import type { FieldInputProps } from './types.js'
import { INPUT_CLS } from './types.js'

export function RichContentInput({ field, value, onChange, disabled = false, userName, userColor, wsPath, docName }: FieldInputProps) {
  const isDisabled = disabled || field.readonly

  // Wait for editorRegistry to be populated by registerLexical() (async dynamic import).
  // SSR: always null. Client: poll until available, then render the real editor.
  const [RichEditor, setRichEditor] = useState<typeof editorRegistry.richcontent>(null)
  useEffect(() => {
    // Already available (e.g. client-side navigation after import completed)
    if (editorRegistry.richcontent) {
      setRichEditor(() => editorRegistry.richcontent)
      return
    }
    // Poll until registerLexical() completes
    const interval = setInterval(() => {
      if (editorRegistry.richcontent) {
        setRichEditor(() => editorRegistry.richcontent)
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
        {...(userName !== undefined ? { userName } : {})}
        {...(userColor !== undefined ? { userColor } : {})}
      />
    )
  }

  // Fallback: shown during SSR and while waiting for registerLexical()
  return (
    <div className="min-h-[200px] rounded-lg border border-input bg-background p-3 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
      Loading editor…
    </div>
  )
}
