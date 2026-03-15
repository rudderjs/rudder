import { useRef, useCallback, useEffect, useState } from 'react'
import { useYTextSync } from '../../_hooks/useYTextSync.js'
import { useYTextCursors } from '../../_hooks/useYTextCursors.js'

interface Props {
  text:      string
  onChange:  (text: string) => void
  tag?:      'p' | 'h1' | 'h2' | 'h3'
  disabled?: boolean
  placeholder?: string
  /** Optional collaborative props */
  yText?:     any | null
  awareness?: any | null
  fieldName?: string
  /** Called when "/" is typed in an empty block — receives caret position for menu placement */
  onSlashCommand?: (position: { top: number; left: number }) => void
  /** Called on double Enter — parent should create a new block after this one */
  onNewBlockAfter?: () => void
  /** Called on Backspace in an empty block — parent should delete this block and focus previous */
  onDeleteBlock?: () => void
  /** When true, arrow/enter/escape keystrokes are forwarded to slash menu handlers */
  slashMenuActive?: boolean
  /** Slash menu navigation callbacks */
  onSlashNavigate?: (delta: number) => void
  onSlashSelect?: () => void
  onSlashClose?: () => void
  onSlashQueryChange?: (query: string) => void
  /** Called on Tab/Shift+Tab — used by list items for indent/outdent */
  onTab?: (shiftKey: boolean) => void
  /** When true, single Enter at end creates new block (used by list items) */
  enterCreatesBlock?: boolean
}

const tagStyles: Record<string, string> = {
  p:  'text-base',
  h1: 'text-3xl font-bold',
  h2: 'text-2xl font-semibold',
  h3: 'text-xl font-semibold',
}

// ── DOM ↔ flat text index mapping ──────────────────────────

/** Walk text nodes to convert a flat char index → { node, offset } in the DOM */
function indexToNodeOffset(root: Node, target: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let count = 0
  while (walker.nextNode()) {
    const len = walker.currentNode.textContent!.length
    if (count + len >= target) {
      return { node: walker.currentNode, offset: target - count }
    }
    count += len
  }
  // Past the end — return last position
  if (root.childNodes.length === 0) return { node: root, offset: 0 }
  return null
}

/** Walk text nodes to convert a DOM { node, offset } → flat char index */
function nodeOffsetToIndex(root: Node, targetNode: Node, offset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let count = 0
  while (walker.nextNode()) {
    if (walker.currentNode === targetNode) return count + offset
    count += walker.currentNode.textContent!.length
  }
  return count
}

/** Get total text length (ignoring HTML tags) */
function textLength(root: Node): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let count = 0
  while (walker.nextNode()) count += walker.currentNode.textContent!.length
  return count
}

export function RichTextBlock({ text, onChange, tag = 'p', disabled, placeholder, yText, awareness, fieldName, onSlashCommand, onNewBlockAfter, onDeleteBlock, slashMenuActive, onSlashNavigate, onSlashSelect, onSlashClose, onSlashQueryChange, onTab, enterCreatesBlock }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const lastHtml = useRef(text)
  const hasFocusRef = useRef(false)
  const relSelRef = useRef<{ anchor: any; focus: any } | null>(null)
  const yRef = useRef<any>(null)
  const lastEnterRef = useRef<number>(0)

  // Load Yjs for RelativePosition
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
    const el = ref.current
    if (!el || !hasFocusRef.current) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (!el.contains(range.startContainer)) return

    const anchorIdx = nodeOffsetToIndex(el, range.startContainer, range.startOffset)
    const focusIdx  = nodeOffsetToIndex(el, range.endContainer, range.endOffset)
    const anchor = toRelPos(anchorIdx)
    const focus  = toRelPos(focusIdx)
    if (anchor && focus) relSelRef.current = { anchor, focus }
  }, [toRelPos])

  const restoreSelection = useCallback(() => {
    const el = ref.current
    const saved = relSelRef.current
    if (!el || !saved || !hasFocusRef.current) return

    const startIdx = fromRelPos(saved.anchor)
    const endIdx   = fromRelPos(saved.focus)
    if (startIdx === null || endIdx === null) return

    const len = textLength(el)
    const startPos = indexToNodeOffset(el, Math.min(startIdx, len))
    const endPos   = indexToNodeOffset(el, Math.min(endIdx, len))
    if (!startPos || !endPos) return

    const sel = window.getSelection()
    if (!sel) return
    const range = document.createRange()
    range.setStart(startPos.node, startPos.offset)
    range.setEnd(endPos.node, endPos.offset)
    sel.removeAllRanges()
    sel.addRange(range)

    // Re-save for next remote edit
    saveSelection()
  }, [fromRelPos, saveSelection])

  // Remote change handler — update DOM directly when focused
  const handleRemoteChange = useCallback((newValue: string) => {
    const el = ref.current
    if (el && hasFocusRef.current) {
      // Don't re-save — use RelativePosition from before the edit
      el.innerHTML = newValue
      lastHtml.current = newValue
      restoreSelection()
      return
    }
    // Not focused — go through React-style update
    if (el) {
      el.innerHTML = newValue
      lastHtml.current = newValue
    }
  }, [restoreSelection])

  const { applyLocalChange } = useYTextSync(
    yText ?? null,
    handleRemoteChange,
  )

  const { remoteCursors, broadcastCursor, clearCursor } = useYTextCursors({
    yText:     yText ?? null,
    awareness: awareness ?? null,
    fieldName: fieldName ?? '',
  })

  // Set initial content on mount
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = text
      lastHtml.current = text
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When yText becomes available (transitions from null), sync innerHTML from Y.Text content.
  // Y.Text is the source of truth — it may contain live edits not yet saved to DB.
  const prevYTextRef = useRef<any>(null)
  useEffect(() => {
    if (yText && yText !== prevYTextRef.current) {
      const yContent = yText.toString()
      if (yContent && ref.current && yContent !== lastHtml.current) {
        ref.current.innerHTML = yContent
        lastHtml.current = yContent
      }
    }
    prevYTextRef.current = yText
  }, [yText])

  // Sync external changes (non-collaborative path) — skip if we're the source
  useEffect(() => {
    // Skip if collaborative — handleRemoteChange handles it
    if (yText) return
    if (ref.current && text !== lastHtml.current) {
      const sel = window.getSelection()
      const hadFocus = document.activeElement === ref.current

      ref.current.innerHTML = text
      lastHtml.current = text

      if (hadFocus && sel && ref.current.childNodes.length > 0) {
        const range = document.createRange()
        range.selectNodeContents(ref.current)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    }
  }, [text, yText])

  const handleInput = useCallback(() => {
    if (!ref.current) return
    const html = sanitizeHtml(ref.current.innerHTML)
    if (html !== lastHtml.current) {
      lastHtml.current = html
      onChange(html)
      applyLocalChange(html)
    }
    // Forward plain text as slash query when menu is active
    if (slashMenuActive && onSlashQueryChange) {
      const plainText = ref.current.textContent ?? ''
      onSlashQueryChange(plainText)
    }
  }, [onChange, applyLocalChange, slashMenuActive, onSlashQueryChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return
    const mod = e.metaKey || e.ctrlKey

    // When slash menu is active, intercept navigation keys
    if (slashMenuActive) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        onSlashNavigate?.(1)
        return
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        onSlashNavigate?.(-1)
        return
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onSlashSelect?.()
        return
      } else if (e.key === 'Escape') {
        e.preventDefault()
        // Clear typed filter text from the contenteditable
        const el = ref.current
        if (el) {
          el.innerHTML = ''
          lastHtml.current = ''
          onChange('')
          applyLocalChange('')
        }
        onSlashClose?.()
        return
      }
      // All other keys: let them type into the contenteditable (used as filter)
      // The onInput handler will fire and we pass query up via handleInput
    }

    if (e.key === 'Tab' && onTab) {
      e.preventDefault()
      onTab(e.shiftKey)
      return
    }

    if (mod && e.key === 'b') {
      e.preventDefault()
      document.execCommand('bold')
    } else if (mod && e.key === 'i') {
      e.preventDefault()
      document.execCommand('italic')
    } else if (mod && e.key === 'u') {
      e.preventDefault()
      document.execCommand('underline')
    } else if (mod && e.key === 'k') {
      e.preventDefault()
      const url = prompt('Link URL:')
      if (url) document.execCommand('createLink', false, url)
    } else if (e.key === 'Backspace' && onDeleteBlock) {
      const el = ref.current
      if (el && (el.textContent ?? '').trim() === '' && el.innerHTML.replace(/<br\s*\/?>/g, '').trim() === '') {
        e.preventDefault()
        onDeleteBlock()
        return
      }
    } else if (e.key === '/' && onSlashCommand) {
      // Show slash command menu if block is empty
      const el = ref.current
      if (el) {
        const plainText = el.textContent ?? ''
        if (plainText.trim() === '') {
          e.preventDefault()
          // Use the element's own rect — range rect is zero in empty contenteditable
          const elRect = el.getBoundingClientRect()
          onSlashCommand({
            top: elRect.bottom + 4,
            left: elRect.left,
          })
        }
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      const now = Date.now()
      const el = ref.current

      // Helper: check if caret is at end of content
      function isCaretAtEnd(): boolean {
        if (!el) return false
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return false
        const range = document.createRange()
        range.setStart(sel.anchorNode!, sel.anchorOffset)
        range.setEnd(el, el.childNodes.length)
        const afterCaret = range.cloneContents()
        const tmp = document.createElement('div')
        tmp.appendChild(afterCaret)
        return (tmp.textContent ?? '').trim() === ''
      }

      // List-item mode: single Enter at end creates new item
      if (enterCreatesBlock && onNewBlockAfter && el) {
        if (isCaretAtEnd()) {
          e.preventDefault()
          onNewBlockAfter()
          return
        }
        // Not at end — insert line break normally
        e.preventDefault()
        document.execCommand('insertLineBreak')
        return
      }

      // Paragraph mode: double Enter at end creates new block
      if (onNewBlockAfter && now - lastEnterRef.current < 500 && el) {
        if (isCaretAtEnd()) {
          e.preventDefault()
          let html = el.innerHTML
          html = html.replace(/(<br\s*\/?>)+\s*$/, '')
          el.innerHTML = html
          lastHtml.current = html
          onChange(html)
          applyLocalChange(html)
          lastEnterRef.current = 0
          onNewBlockAfter()
          return
        }
      }

      lastEnterRef.current = now
      e.preventDefault()
      document.execCommand('insertLineBreak')
    }
  }, [disabled, slashMenuActive, onSlashNavigate, onSlashSelect, onSlashClose, onSlashCommand, onNewBlockAfter, onDeleteBlock, onChange, applyLocalChange, onTab, enterCreatesBlock])

  // Broadcast cursor on selection changes
  const handleSelectionBroadcast = useCallback(() => {
    const el = ref.current
    if (!el) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return

    const anchorIdx = nodeOffsetToIndex(el, sel.anchorNode!, sel.anchorOffset)
    const focusIdx  = nodeOffsetToIndex(el, sel.focusNode!, sel.focusOffset)
    saveSelection()
    broadcastCursor(anchorIdx, focusIdx)
  }, [broadcastCursor, saveSelection])

  // Listen for selectionchange
  useEffect(() => {
    if (!yText || !awareness) return
    function onSelectionChange() {
      const el = ref.current
      if (document.activeElement === el || el?.contains(document.activeElement as Node)) {
        hasFocusRef.current = true
        handleSelectionBroadcast()
      } else if (hasFocusRef.current) {
        hasFocusRef.current = false
        relSelRef.current = null
        clearCursor()
      }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [yText, awareness, handleSelectionBroadcast, clearCursor])

  const handleFocus = useCallback(() => {
    hasFocusRef.current = true
    handleSelectionBroadcast()
  }, [handleSelectionBroadcast])

  const handleBlur = useCallback(() => {
    hasFocusRef.current = false
    relSelRef.current = null
    clearCursor()
  }, [clearCursor])

  return (
    <div className="relative">
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        data-placeholder={placeholder ?? ''}
        className={[
          tagStyles[tag] ?? tagStyles.p,
          'outline-none min-h-[1.5em] px-1 py-0.5 rounded',
          'focus:bg-accent/30 transition-colors',
          'empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50',
          disabled ? 'cursor-default' : '',
          '[&_a]:text-primary [&_a]:underline',
        ].join(' ')}
      />

      {/* Remote cursor indicators */}
      {remoteCursors.map((cursor) => (
        <ContentEditableCursor
          key={cursor.clientId}
          cursor={cursor}
          containerRef={ref}
        />
      ))}
    </div>
  )
}

/** Renders a remote user's cursor/selection inside a contenteditable element */
function ContentEditableCursor({
  cursor,
  containerRef,
}: {
  cursor: { clientId: number; name: string; color: string; anchor: number; focus: number }
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const [rects, setRects] = useState<Array<{ left: number; top: number; width: number; height: number }>>([])
  const [labelPos, setLabelPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const len = textLength(el)
    const startIdx = Math.min(cursor.anchor, len)
    const endIdx   = Math.min(cursor.focus, len)
    const isCaret  = startIdx === endIdx

    const startPos = indexToNodeOffset(el, startIdx)
    const endPos   = isCaret ? startPos : indexToNodeOffset(el, endIdx)

    if (!startPos || !endPos) {
      setRects([])
      setLabelPos(null)
      return
    }

    const range = document.createRange()
    range.setStart(startPos.node, startPos.offset)
    range.setEnd(endPos.node, endPos.offset)

    const elRect      = el.getBoundingClientRect()
    const clientRects = isCaret
      ? [range.getBoundingClientRect()]
      : Array.from(range.getClientRects())

    const newRects = clientRects
      .filter(r => r.width > 0 || isCaret)
      .map(r => ({
        left:   r.left - elRect.left,
        top:    r.top  - elRect.top,
        width:  isCaret ? 2 : r.width,
        height: r.height,
      }))

    setRects(newRects)
    if (newRects.length > 0) {
      setLabelPos({ left: newRects[0]!.left, top: newRects[0]!.top - 14 })
    } else {
      setLabelPos(null)
    }
  }, [cursor.anchor, cursor.focus, containerRef])

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

function sanitizeHtml(html: string): string {
  return html
    .replace(/<(?!\/?(?:b|i|u|s|a|br)\b)[^>]*>/gi, '')
    .replace(/<(b|i|u|s|br)(\s[^>]*)?>/gi, '<$1>')
    .replace(/<a\s+(?:(?!href)[^>])*?(href="[^"]*")[^>]*>/gi, '<a $1>')
    .replace(/<(\w+)>\s*<\/\1>/g, '')
    .replace(/&nbsp;/g, ' ')
}
