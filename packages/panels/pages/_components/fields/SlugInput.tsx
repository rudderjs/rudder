import { useRef, useCallback } from 'react'
import type { FieldInputProps } from './types.js'

/** Convert text to a URL-safe slug. Supports Unicode (Arabic, Hebrew, CJK, etc.) */
function toSlug(text: string, final = false): string {
  let slug = text
    .toLowerCase()
    .normalize('NFKD')                    // normalize accented chars
    .replace(/[\u0300-\u036f]/g, '')      // strip combining marks (é → e)
    .replace(/[\s_]+/g, '-')             // spaces/underscores → dash
    .replace(/[^\p{L}\p{N}-]/gu, '')     // keep unicode letters, numbers, dashes
    .replace(/-+/g, '-')                 // collapse multiple dashes
  if (final) {
    slug = slug.replace(/(^-|-$)/g, '')  // trim leading/trailing dashes only on final output
  }
  return slug
}

export function SlugInput({ field, value, onChange, disabled = false, formValues }: FieldInputProps) {
  const isDisabled = disabled || field.readonly
  const sourceField = field.extra?.['from'] as string | undefined
  const currentSlug = (value as string) ?? ''
  const sourceValue = sourceField && formValues ? String(formValues[sourceField] ?? '') : ''
  const expectedSlug = toSlug(sourceValue, true)

  // The slug is "in sync" with the title when they match.
  // When they don't match and the slug is non-empty, it was manually edited.
  // This is derived purely from the synced data — works across all users/tabs.
  const isEdited = currentSlug !== '' && currentSlug !== expectedSlug

  // Track the previous source value to detect when the user is actively typing in the title.
  // We only auto-generate when the source CHANGES (not on mount/load).
  const prevSourceRef = useRef(sourceValue)
  // Track whether user typed directly in the slug input this session (local-only, transient)
  const typedInSlugRef = useRef(false)

  // Auto-generate: source value changed AND slug currently matches the old expected value
  // This means: title is being actively typed, and slug was following along (not manually edited)
  if (sourceField && !isDisabled && sourceValue !== prevSourceRef.current) {
    const prevExpected = toSlug(prevSourceRef.current, true)
    const slugWasFollowing = currentSlug === prevExpected || currentSlug === ''
    prevSourceRef.current = sourceValue

    if (slugWasFollowing && !typedInSlugRef.current) {
      // Slug was in sync with the old title — update it to match new title
      if (expectedSlug !== currentSlug) {
        queueMicrotask(() => onChange(expectedSlug))
      }
    }
  }
  prevSourceRef.current = sourceValue

  const handleChange = useCallback((newValue: string) => {
    const slugified = toSlug(newValue)
    if (slugified === '') {
      typedInSlugRef.current = false
      onChange('')
    } else {
      typedInSlugRef.current = true
      onChange(slugified)
    }
  }, [onChange])

  const handleUnlock = useCallback(() => {
    typedInSlugRef.current = false
    onChange(expectedSlug)
  }, [onChange, expectedSlug])

  return (
    <div className="flex items-center rounded-md border border-input bg-muted overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent">
      <span className="px-3 text-sm text-muted-foreground select-none border-r border-input bg-muted">/</span>
      <input
        type="text"
        name={field.name}
        value={currentSlug}
        onChange={(e) => handleChange(e.target.value)}
        required={field.required}
        readOnly={field.readonly}
        disabled={isDisabled}
        placeholder="my-slug"
        className="flex-1 px-3 py-2 text-sm bg-background focus:outline-none disabled:bg-muted disabled:text-muted-foreground"
      />
      {isEdited && sourceField && !isDisabled && (
        <button
          type="button"
          onClick={handleUnlock}
          title="Regenerate from title"
          className="px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ↻
        </button>
      )}
    </div>
  )
}
