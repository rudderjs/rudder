import { useRef, useCallback, useEffect, useState } from 'react'
import { useYTextSync } from '../../_hooks/useYTextSync.js'
import { useYTextCursors } from '../../_hooks/useYTextCursors.js'

interface Props {
  value:       string
  onChange:    (value: string) => void
  yText:       any | null
  awareness:   any | null
  fieldName:   string
  className?:  string
  placeholder?: string
  disabled?:   boolean
  required?:   boolean
  readOnly?:   boolean
  type?:       string
  name?:       string
}

export function CollaborativeInput({
  value, onChange, yText, awareness, fieldName,
  className, placeholder, disabled, required, readOnly, type = 'text', name,
}: Props) {
  const inputRef  = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLSpanElement>(null)
  const hasFocusRef = useRef(false)

  /**
   * Remote change handler — when this input has focus, update the DOM directly
   * to avoid React re-render which would reset the native selection and cause flashing.
   * When unfocused, go through React state normally.
   */
  const handleRemoteChange = useCallback((newValue: string) => {
    const el = inputRef.current
    if (el && hasFocusRef.current) {
      // Save selection
      const start = el.selectionStart ?? 0
      const end   = el.selectionEnd   ?? 0

      // Update DOM directly — no React re-render
      el.value = newValue

      // Restore selection (clamped to new length)
      el.setSelectionRange(
        Math.min(start, newValue.length),
        Math.min(end,   newValue.length),
      )
      return
    }
    onChange(newValue)
  }, [onChange])

  const { applyLocalChange } = useYTextSync(yText, handleRemoteChange)
  const { remoteCursors, broadcastCursor, clearCursor } = useYTextCursors({ yText, awareness, fieldName })

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value
    onChange(newVal)
    applyLocalChange(newVal)
  }, [onChange, applyLocalChange])

  const handleSelect = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    broadcastCursor(el.selectionStart ?? 0, el.selectionEnd ?? 0)
  }, [broadcastCursor])

  const handleFocus = useCallback(() => {
    hasFocusRef.current = true
    handleSelect()
  }, [handleSelect])

  const handleBlur = useCallback(() => {
    hasFocusRef.current = false
    // Sync DOM value back to React state in case remote changes were applied directly
    const el = inputRef.current
    if (el) onChange(el.value)
    clearCursor()
  }, [clearCursor, onChange])

  // Use document selectionchange for live selection updates (fires during mouse drag)
  // Also clears cursor when focus moves to another element
  useEffect(() => {
    function onSelectionChange() {
      if (document.activeElement === inputRef.current) {
        hasFocusRef.current = true
        handleSelect()
      } else if (hasFocusRef.current) {
        hasFocusRef.current = false
        clearCursor()
      }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [handleSelect, clearCursor])

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type={type}
        name={name}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        readOnly={readOnly}
        className={className}
      />

      {/* Hidden mirror for cursor position calculation */}
      <span
        ref={mirrorRef}
        aria-hidden
        className="absolute top-0 left-0 invisible whitespace-pre pointer-events-none"
        style={{ font: 'inherit', padding: 'inherit', border: 'inherit' }}
      />

      {/* Remote cursor indicators */}
      {remoteCursors.map((cursor) => (
        <CursorIndicator
          key={cursor.clientId}
          cursor={cursor}
          inputRef={inputRef}
          mirrorRef={mirrorRef}
          value={value}
        />
      ))}
    </div>
  )
}

function CursorIndicator({
  cursor, inputRef, mirrorRef, value,
}: {
  cursor: { clientId: number; name: string; color: string; anchor: number; focus: number }
  inputRef: React.RefObject<HTMLInputElement | null>
  mirrorRef: React.RefObject<HTMLSpanElement | null>
  value: string
}) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useEffect(() => {
    const input = inputRef.current
    const mirror = mirrorRef.current
    if (!input || !mirror) return

    // Use the actual DOM value (may differ from React value during direct updates)
    const text = input.value

    const styles = window.getComputedStyle(input)
    mirror.style.font = styles.font
    mirror.style.letterSpacing = styles.letterSpacing
    mirror.style.paddingLeft = styles.paddingLeft
    mirror.style.borderLeftWidth = styles.borderLeftWidth

    const cursorIdx = Math.min(cursor.anchor, text.length)
    mirror.textContent = text.slice(0, cursorIdx)
    const inputRect  = input.getBoundingClientRect()
    const mirrorRect = mirror.getBoundingClientRect()

    const left   = mirrorRect.width - input.scrollLeft
    const height = inputRect.height - 8

    if (cursor.anchor === cursor.focus) {
      setPos({ left, top: 4, width: 2, height })
    } else {
      const endIdx = Math.min(cursor.focus, text.length)
      mirror.textContent = text.slice(0, endIdx)
      const endLeft = mirror.getBoundingClientRect().width - input.scrollLeft
      const selLeft = Math.min(left, endLeft)
      const selWidth = Math.abs(endLeft - left)
      setPos({ left: selLeft, top: 4, width: Math.max(selWidth, 2), height })
    }
  }, [cursor.anchor, cursor.focus, value, inputRef, mirrorRef])

  if (!pos) return null

  const isCaret = cursor.anchor === cursor.focus

  return (
    <>
      <div
        className="absolute pointer-events-none"
        style={{
          left: pos.left,
          top: pos.top,
          width: pos.width,
          height: pos.height,
          backgroundColor: cursor.color,
          opacity: isCaret ? 1 : 0.15,
          borderRadius: isCaret ? 0 : 2,
        }}
      />
      <div
        className="absolute pointer-events-none z-10 text-[10px] text-white px-1 rounded-t whitespace-nowrap"
        style={{
          left: pos.left,
          top: pos.top - 14,
          backgroundColor: cursor.color,
        }}
      >
        {cursor.name}
      </div>
    </>
  )
}
