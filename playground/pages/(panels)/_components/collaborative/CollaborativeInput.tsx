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
  /** Selection stored as Y.RelativePositions — survives remote inserts/deletes */
  const relSelRef = useRef<{ anchor: any; focus: any } | null>(null)
  const yRef = useRef<any>(null)

  // Keep Yjs module ref for sync access
  useEffect(() => {
    import('yjs').then(mod => { yRef.current = mod })
  }, [])

  /** Convert absolute index → Y.RelativePosition (survives remote edits) */
  const toRelPos = useCallback((index: number) => {
    const Y = yRef.current
    if (!Y || !yText) return null
    return Y.createRelativePositionFromTypeIndex(yText, index)
  }, [yText])

  /** Convert Y.RelativePosition → absolute index */
  const fromRelPos = useCallback((relPos: any): number | null => {
    const Y = yRef.current
    if (!Y || !yText || !relPos) return null
    const abs = Y.createAbsolutePositionFromRelativePosition(relPos, yText.doc)
    return abs ? abs.index : null
  }, [yText])

  /** Save current selection as relative positions */
  const saveSelection = useCallback(() => {
    const el = inputRef.current
    if (!el || !hasFocusRef.current) return
    const anchor = toRelPos(el.selectionStart ?? 0)
    const focus  = toRelPos(el.selectionEnd   ?? 0)
    if (anchor && focus) {
      relSelRef.current = { anchor, focus }
    }
  }, [toRelPos])

  /**
   * Remote change handler — update DOM directly to avoid React re-render.
   * Restore selection using Y.RelativePosition so it shifts correctly
   * when text is inserted/deleted before the cursor.
   */
  const handleRemoteChange = useCallback((newValue: string) => {
    const el = inputRef.current
    if (el && hasFocusRef.current) {
      // Save selection as relative positions BEFORE applying the change
      // (already saved via selectionchange, but ensure it's current)
      saveSelection()

      // Update DOM directly
      el.value = newValue

      // Restore selection from relative positions (now adjusted for the remote edit)
      const saved = relSelRef.current
      if (saved) {
        const start = fromRelPos(saved.anchor)
        const end   = fromRelPos(saved.focus)
        if (start !== null && end !== null) {
          el.setSelectionRange(
            Math.min(start, newValue.length),
            Math.min(end,   newValue.length),
          )
        }
      }
      return
    }
    onChange(newValue)
  }, [onChange, saveSelection, fromRelPos])

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
    // Save as relative positions for remote edit adjustment
    saveSelection()
    broadcastCursor(el.selectionStart ?? 0, el.selectionEnd ?? 0)
  }, [broadcastCursor, saveSelection])

  const handleFocus = useCallback(() => {
    hasFocusRef.current = true
    handleSelect()
  }, [handleSelect])

  const handleBlur = useCallback(() => {
    hasFocusRef.current = false
    relSelRef.current = null
    const el = inputRef.current
    if (el) onChange(el.value)
    clearCursor()
  }, [clearCursor, onChange])

  // Use document selectionchange for live updates + focus-loss detection
  useEffect(() => {
    function onSelectionChange() {
      if (document.activeElement === inputRef.current) {
        hasFocusRef.current = true
        handleSelect()
      } else if (hasFocusRef.current) {
        hasFocusRef.current = false
        relSelRef.current = null
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
        />
      ))}
    </div>
  )
}

function CursorIndicator({
  cursor, inputRef, mirrorRef,
}: {
  cursor: { clientId: number; name: string; color: string; anchor: number; focus: number }
  inputRef: React.RefObject<HTMLInputElement | null>
  mirrorRef: React.RefObject<HTMLSpanElement | null>
}) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useEffect(() => {
    const input = inputRef.current
    const mirror = mirrorRef.current
    if (!input || !mirror) return

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
  }, [cursor.anchor, cursor.focus, inputRef, mirrorRef])

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
