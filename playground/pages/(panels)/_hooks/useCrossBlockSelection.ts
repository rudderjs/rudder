import { useState, useCallback, useEffect, useRef } from 'react'

export interface CrossBlockSelection {
  startBlockId:  string
  startOffset:   number
  endBlockId:    string
  endOffset:     number
}

interface UseCrossBlockSelectionReturn {
  selection:       CrossBlockSelection | null
  clearSelection:  () => void
  handleMouseDown: (e: React.MouseEvent) => void
  getBlockHighlight: (blockId: string) => { type: 'none' | 'full' | 'start' | 'end'; startOffset?: number; endOffset?: number }
}

export function useCrossBlockSelection(blockIds: string[]): UseCrossBlockSelectionReturn {
  const [selection, setSelection] = useState<CrossBlockSelection | null>(null)
  const draggingRef = useRef(false)
  const startRef    = useRef<{ blockId: string; offset: number } | null>(null)
  const blockIdsRef = useRef(blockIds)
  blockIdsRef.current = blockIds

  function resolvePosition(e: MouseEvent | React.MouseEvent): { blockId: string; offset: number } | null {
    let el = e.target as HTMLElement | null
    while (el) {
      if (el.dataset?.blockId) break
      el = el.parentElement
    }
    if (!el) return null

    const blockId = el.dataset.blockId!
    const editable = el.querySelector('[contenteditable]') as HTMLElement | null
    if (!editable) return null

    let offset = 0
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(e.clientX, e.clientY)
      if (range) offset = getTextOffset(editable, range.startContainer, range.startOffset)
    }

    return { blockId, offset }
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = resolvePosition(e)
    if (!pos) return
    startRef.current = pos
    draggingRef.current = true
    setSelection(null)
  }, [])

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!draggingRef.current || !startRef.current) return
      const pos = resolvePosition(e)
      if (!pos) return

      if (pos.blockId === startRef.current.blockId) {
        setSelection(null)
        return
      }

      e.preventDefault()
      window.getSelection()?.removeAllRanges()

      setSelection({
        startBlockId:  startRef.current.blockId,
        startOffset:   startRef.current.offset,
        endBlockId:    pos.blockId,
        endOffset:     pos.offset,
      })
    }

    function handleMouseUp() {
      draggingRef.current = false
      startRef.current = null
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  useEffect(() => {
    if (!selection) return

    function handleKeyDown(e: KeyboardEvent) {
      if (!selection) return

      if (e.key === 'Escape') {
        setSelection(null)
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault()
        const text = getSelectedText(selection, blockIdsRef.current)
        if (text) navigator.clipboard.writeText(text)
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('crossblock:delete', { detail: selection }))
        setSelection(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selection])

  const clearSelection = useCallback(() => setSelection(null), [])

  const getBlockHighlight = useCallback((blockId: string) => {
    if (!selection) return { type: 'none' as const }

    const ids = blockIdsRef.current
    const startIdx = ids.indexOf(selection.startBlockId)
    const endIdx   = ids.indexOf(selection.endBlockId)
    const blockIdx = ids.indexOf(blockId)
    if (startIdx === -1 || endIdx === -1 || blockIdx === -1) return { type: 'none' as const }

    const lo = Math.min(startIdx, endIdx)
    const hi = Math.max(startIdx, endIdx)

    if (blockIdx < lo || blockIdx > hi) return { type: 'none' as const }

    const isForward = startIdx <= endIdx
    const firstId = isForward ? selection.startBlockId : selection.endBlockId
    const firstOff = isForward ? selection.startOffset : selection.endOffset
    const lastId  = isForward ? selection.endBlockId : selection.startBlockId
    const lastOff = isForward ? selection.endOffset : selection.startOffset

    if (blockId === firstId && blockId === lastId) {
      return { type: 'start' as const, startOffset: Math.min(firstOff, lastOff), endOffset: Math.max(firstOff, lastOff) }
    }
    if (blockId === firstId) return { type: 'start' as const, startOffset: firstOff }
    if (blockId === lastId)  return { type: 'end' as const, endOffset: lastOff }
    return { type: 'full' as const }
  }, [selection])

  return { selection, clearSelection, handleMouseDown, getBlockHighlight }
}

function getTextOffset(root: Node, targetNode: Node, offset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let count = 0
  while (walker.nextNode()) {
    if (walker.currentNode === targetNode) return count + offset
    count += walker.currentNode.textContent!.length
  }
  return count
}

function getSelectedText(sel: CrossBlockSelection, blockIds: string[]): string {
  const startIdx = blockIds.indexOf(sel.startBlockId)
  const endIdx   = blockIds.indexOf(sel.endBlockId)
  const lo = Math.min(startIdx, endIdx)
  const hi = Math.max(startIdx, endIdx)

  const parts: string[] = []
  for (let i = lo; i <= hi; i++) {
    const el = document.querySelector(`[data-block-id="${blockIds[i]}"] [contenteditable]`) as HTMLElement | null
    if (!el) continue
    const text = el.textContent ?? ''
    if (i === lo && i === hi) {
      const a = Math.min(sel.startOffset, sel.endOffset)
      const b = Math.max(sel.startOffset, sel.endOffset)
      parts.push(text.slice(a, b))
    } else if (i === lo) {
      const off = blockIds[i] === sel.startBlockId ? sel.startOffset : sel.endOffset
      parts.push(text.slice(off))
    } else if (i === hi) {
      const off = blockIds[i] === sel.endBlockId ? sel.endOffset : sel.startOffset
      parts.push(text.slice(0, off))
    } else {
      parts.push(text)
    }
  }
  return parts.join('\n')
}
