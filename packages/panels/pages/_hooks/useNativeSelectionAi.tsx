'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * Hook that detects text selection in a native <input> or <textarea> and
 * renders a floating ✦ "Ask AI" button beside the caret.
 *
 * Returns a portal element to render (null when no selection).
 */
export function useNativeSelectionAi(
  elRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  onAskAi: ((text: string) => void) | undefined,
): React.ReactNode {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const selectedTextRef = useRef('')
  const btnRef = useRef<HTMLButtonElement>(null)

  const checkSelection = useCallback(() => {
    const el = elRef.current
    if (!el || !onAskAi) return

    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (start === end || start === null || end === null) {
      setVisible(false)
      return
    }

    const text = el.value.slice(start, end)
    if (!text.trim()) {
      setVisible(false)
      return
    }

    selectedTextRef.current = text

    // Position beside the element's right edge, vertically centered
    const rect = el.getBoundingClientRect()
    setPos({ x: rect.right + 4, y: rect.top + rect.height / 2 - 12 })
    setVisible(true)
  }, [elRef, onAskAi])

  useEffect(() => {
    const el = elRef.current
    if (!el || !onAskAi) return

    const onSelect = () => checkSelection()
    const onBlur = (e: FocusEvent) => {
      // Don't hide if clicking the AI button
      if (btnRef.current?.contains(e.relatedTarget as Node)) return
      setVisible(false)
    }

    el.addEventListener('select', onSelect)
    el.addEventListener('mouseup', onSelect)
    el.addEventListener('keyup', onSelect)
    el.addEventListener('blur', onBlur)

    return () => {
      el.removeEventListener('select', onSelect)
      el.removeEventListener('mouseup', onSelect)
      el.removeEventListener('keyup', onSelect)
      el.removeEventListener('blur', onBlur)
    }
  }, [elRef, onAskAi, checkSelection])

  if (!visible || !onAskAi || typeof document === 'undefined') return null

  return createPortal(
    <button
      ref={btnRef}
      type="button"
      className="fixed z-50 flex items-center justify-center h-6 w-6 rounded-md bg-popover border border-border shadow-lg text-primary hover:bg-accent/50 transition-colors"
      title="Ask AI"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => {
        e.preventDefault()
        const text = selectedTextRef.current
        if (text) {
          onAskAi(text)
          setVisible(false)
        }
      }}
    >
      <span className="text-sm">✦</span>
    </button>,
    document.body,
  )
}
