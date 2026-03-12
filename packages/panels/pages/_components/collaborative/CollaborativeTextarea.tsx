import { useRef, useCallback, useEffect, useState } from 'react'
import { useYTextSync } from '../../_hooks/useYTextSync.js'
import { useYTextCursors } from '../../_hooks/useYTextCursors.js'

interface Props {
  value:       string
  onChange:    (value: string) => void
  yText:       any | null
  awareness:   any | null
  fieldName:   string
  rows?:       number
  className?:  string
  placeholder?: string
  disabled?:   boolean
  required?:   boolean
  readOnly?:   boolean
  name?:       string
}

export function CollaborativeTextarea({
  value, onChange, yText, awareness, fieldName,
  rows = 4, className, placeholder, disabled, required, readOnly, name,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef   = useRef<HTMLDivElement>(null)
  const hasFocusRef = useRef(false)
  const relSelRef   = useRef<{ anchor: any; focus: any } | null>(null)
  const yRef        = useRef<any>(null)

  useEffect(() => {
    import('yjs').then(mod => { yRef.current = mod })
  }, [])

  const toRelPos = useCallback((index: number) => {
    const Y = yRef.current
    if (!Y || !yText) return null
    return Y.createRelativePositionFromTypeIndex(yText, index)
  }, [yText])

  const fromRelPos = useCallback((relPos: any): number | null => {
    const Y = yRef.current
    if (!Y || !yText || !relPos) return null
    const abs = Y.createAbsolutePositionFromRelativePosition(relPos, yText.doc)
    return abs ? abs.index : null
  }, [yText])

  const saveSelection = useCallback(() => {
    const el = textareaRef.current
    if (!el || !hasFocusRef.current) return
    const anchor = toRelPos(el.selectionStart ?? 0)
    const focus  = toRelPos(el.selectionEnd   ?? 0)
    if (anchor && focus) {
      relSelRef.current = { anchor, focus }
    }
  }, [toRelPos])

  const handleRemoteChange = useCallback((newValue: string) => {
    const el = textareaRef.current
    if (el && hasFocusRef.current) {
      saveSelection()
      el.value = newValue

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

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value
    onChange(newVal)
    applyLocalChange(newVal)
  }, [onChange, applyLocalChange])

  const handleSelect = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
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
    const el = textareaRef.current
    if (el) onChange(el.value)
    clearCursor()
  }, [clearCursor, onChange])

  useEffect(() => {
    function onSelectionChange() {
      if (document.activeElement === textareaRef.current) {
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
      <textarea
        ref={textareaRef}
        name={name}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        readOnly={readOnly}
        className={className}
      />

      {/* Hidden mirror div for 2D position calculation */}
      <div
        ref={mirrorRef}
        aria-hidden
        className="absolute top-0 left-0 invisible pointer-events-none overflow-hidden"
        style={{
          font: 'inherit',
          padding: 'inherit',
          border: 'inherit',
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
          width: '100%',
        }}
      />

      {/* Remote cursor indicators */}
      {remoteCursors.map((cursor) => (
        <TextareaCursor
          key={cursor.clientId}
          cursor={cursor}
          textareaRef={textareaRef}
          mirrorRef={mirrorRef}
        />
      ))}
    </div>
  )
}

function TextareaCursor({
  cursor, textareaRef, mirrorRef,
}: {
  cursor: { clientId: number; name: string; color: string; anchor: number; focus: number }
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  mirrorRef: React.RefObject<HTMLDivElement | null>
}) {
  const [rects, setRects] = useState<Array<{ left: number; top: number; width: number; height: number }>>([])
  const [labelPos, setLabelPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    const mirror   = mirrorRef.current
    if (!textarea || !mirror) return

    const text = textarea.value

    const styles = window.getComputedStyle(textarea)
    ;['font', 'letterSpacing', 'lineHeight', 'padding', 'border', 'width'].forEach(prop => {
      ;(mirror.style as any)[prop] = styles.getPropertyValue(prop)
    })

    const anchorIdx = Math.min(cursor.anchor, text.length)
    const focusIdx  = Math.min(cursor.focus, text.length)
    const start     = Math.min(anchorIdx, focusIdx)
    const end       = Math.max(anchorIdx, focusIdx)

    const before = document.createTextNode(text.slice(0, start))
    const marker = document.createElement('span')
    marker.textContent = text.slice(start, end) || '\u200B'
    const after = document.createTextNode(text.slice(end))

    mirror.innerHTML = ''
    mirror.appendChild(before)
    mirror.appendChild(marker)
    mirror.appendChild(after)

    const textareaRect = textarea.getBoundingClientRect()
    const markerRects  = marker.getClientRects()
    const scrollTop    = textarea.scrollTop
    const scrollLeft   = textarea.scrollLeft

    const newRects: typeof rects = []
    for (const r of markerRects) {
      newRects.push({
        left:   r.left - textareaRect.left - scrollLeft,
        top:    r.top  - textareaRect.top  - scrollTop,
        width:  start === end ? 2 : r.width,
        height: r.height,
      })
    }

    setRects(newRects)
    if (newRects.length > 0) {
      setLabelPos({ left: newRects[0]!.left, top: newRects[0]!.top - 14 })
    }
  }, [cursor.anchor, cursor.focus, textareaRef, mirrorRef])

  const isCaret = cursor.anchor === cursor.focus

  return (
    <>
      {rects.map((r, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            backgroundColor: cursor.color,
            opacity: isCaret ? 1 : 0.15,
          }}
        />
      ))}
      {labelPos && (
        <div
          className="absolute pointer-events-none z-10 text-[10px] text-white px-1 rounded-t whitespace-nowrap"
          style={{
            left: labelPos.left,
            top: labelPos.top,
            backgroundColor: cursor.color,
          }}
        >
          {cursor.name}
        </div>
      )}
    </>
  )
}
