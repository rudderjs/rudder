import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection, $isRangeSelection,
  FORMAT_TEXT_COMMAND, SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
} from 'lexical'
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { computePosition, flip, offset, shift, autoUpdate } from '@floating-ui/dom'
import { mergeRegister } from '@lexical/utils'
import type { ToolbarConfig } from '../toolbar.js'
import { hasTool } from '../toolbar.js'

interface FloatingToolbarProps {
  config?: ToolbarConfig | undefined
}

export function FloatingToolbarPlugin({ config }: FloatingToolbarProps = {}) {
  const [editor] = useLexicalComposerContext()
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)
  const [isStrikethrough, setIsStrikethrough] = useState(false)
  const [isCode, setIsCode] = useState(false)
  const [isLink, setIsLink] = useState(false)

  const cleanupRef = useRef<(() => void) | null>(null)

  const positionToolbar = useCallback(() => {
    const nativeSelection = window.getSelection()
    const toolbar = toolbarRef.current
    if (!nativeSelection || nativeSelection.rangeCount === 0 || !toolbar) return

    const range = nativeSelection.getRangeAt(0)
    const virtualEl = {
      getBoundingClientRect: () => range.getBoundingClientRect(),
      getClientRects: () => range.getClientRects(),
    }

    computePosition(virtualEl as Element, toolbar, {
      placement: 'top',
      strategy: 'fixed',
      middleware: [offset(8), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      toolbar.style.left = `${x}px`
      toolbar.style.top = `${y}px`
    })
  }, [])

  const updateToolbar = useCallback(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || selection.isCollapsed()) {
      setIsVisible(false)
      return
    }

    setIsBold(selection.hasFormat('bold'))
    setIsItalic(selection.hasFormat('italic'))
    setIsUnderline(selection.hasFormat('underline'))
    setIsStrikethrough(selection.hasFormat('strikethrough'))
    setIsCode(selection.hasFormat('code'))

    const node = selection.anchor.getNode()
    const parent = node.getParent()
    setIsLink($isLinkNode(parent) || $isLinkNode(node))

    setIsVisible(true)

    requestAnimationFrame(() => positionToolbar())
  }, [positionToolbar])

  // Close toolbar on click outside
  useEffect(() => {
    if (!isVisible) return
    const handleMouseDown = (e: MouseEvent) => {
      const toolbar = toolbarRef.current
      if (toolbar && !toolbar.contains(e.target as Node)) {
        setIsVisible(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [isVisible])

  // Auto-track scroll/resize to keep toolbar positioned
  useEffect(() => {
    if (!isVisible) {
      cleanupRef.current?.()
      cleanupRef.current = null
      return
    }

    const toolbar = toolbarRef.current
    const rootEl = editor.getRootElement()
    if (!toolbar || !rootEl) return

    // Use the editor root as the reference for autoUpdate's scroll ancestor detection
    cleanupRef.current = autoUpdate(rootEl, toolbar, positionToolbar)

    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [isVisible, editor, positionToolbar])

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => updateToolbar())
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => { editor.getEditorState().read(() => updateToolbar()); return false },
        COMMAND_PRIORITY_LOW,
      ),
    )
  }, [editor, updateToolbar])

  const [linkMode, setLinkMode] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const linkInputRef = useRef<HTMLInputElement>(null)

  const toggleLink = useCallback(() => {
    if (isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
      setLinkMode(false)
    } else {
      setLinkMode(true)
      setLinkUrl('')
      requestAnimationFrame(() => linkInputRef.current?.focus())
    }
  }, [editor, isLink])

  const submitLink = useCallback(() => {
    if (linkUrl.trim()) {
      const url = linkUrl.trim().startsWith('http') ? linkUrl.trim() : `https://${linkUrl.trim()}`
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)
    }
    setLinkMode(false)
    setLinkUrl('')
  }, [editor, linkUrl])

  if (!isVisible) return null

  const has = (tool: string) => !config || hasTool(config, tool as import('../toolbar.js').ToolbarTool)

  const formatBtns = [
    has('bold') && <ToolbarBtn key="b" active={isBold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} label="B" title="Bold" className="font-bold" />,
    has('italic') && <ToolbarBtn key="i" active={isItalic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} label="I" title="Italic" className="italic" />,
    has('underline') && <ToolbarBtn key="u" active={isUnderline} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')} label="U" title="Underline" className="underline" />,
    has('strikethrough') && <ToolbarBtn key="s" active={isStrikethrough} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')} label="S" title="Strikethrough" className="line-through" />,
  ].filter(Boolean)

  const extraBtns = [
    has('code') && <ToolbarBtn key="code" active={isCode} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')} label="<>" title="Code" className="font-mono text-xs" />,
    has('link') && <ToolbarBtn key="link" active={isLink || linkMode} onClick={toggleLink} label="🔗" title="Link" />,
  ].filter(Boolean)

  return createPortal(
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-0.5 bg-popover border border-border rounded-lg shadow-lg p-1"
    >
      {linkMode ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => { e.preventDefault(); submitLink() }}
        >
          <input
            ref={linkInputRef}
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="Paste URL…"
            className="h-6 w-40 rounded border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => { if (e.key === 'Escape') { setLinkMode(false); setLinkUrl('') } }}
          />
          <button type="submit" className="px-1.5 py-0.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90">↵</button>
          <button type="button" onClick={() => { setLinkMode(false); setLinkUrl('') }} className="px-1 py-0.5 rounded text-xs text-muted-foreground hover:bg-accent/50">✕</button>
        </form>
      ) : (
        <>
          {formatBtns}
          {formatBtns.length > 0 && extraBtns.length > 0 && <div className="w-px h-5 bg-border mx-0.5" />}
          {extraBtns}
        </>
      )}
    </div>,
    document.body,
  )
}

function ToolbarBtn({ active, onClick, label, title, className }: {
  active: boolean; onClick: () => void; label: string; title: string; className?: string
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      className={[
        'px-2 py-1 rounded text-sm transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
        className,
      ].filter(Boolean).join(' ')}
    >
      {label}
    </button>
  )
}
