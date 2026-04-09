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

/**
 * Anchor-rect type passed back to `onSelectionAction` so the parent can
 * position its inline menu just below the trigger button.
 */
export interface SelectionAiAnchorRect {
  left:   number
  top:    number
  right:  number
  bottom: number
}

interface FloatingToolbarProps {
  config?: ToolbarConfig | undefined
  /** Callback to enter link edit mode (shared with FloatingLinkEditorPlugin) */
  onInsertLink?: () => void
  /**
   * Called when the user clicks the inline `✦` button. Receives the captured
   * selection text and the button's bounding rect (so the parent can anchor
   * a popover to it). Hide the button by passing `undefined`.
   */
  onSelectionAction?: ((text: string, anchorRect: SelectionAiAnchorRect) => void) | undefined
  /**
   * Called when the user clicks the inline `💬` button. Receives the captured
   * selection text. Hide the button by passing `undefined`.
   */
  onAskChat?: ((text: string) => void) | undefined
}

export function FloatingToolbarPlugin({ config, onInsertLink, onSelectionAction, onAskChat }: FloatingToolbarProps = {}) {
  const [editor] = useLexicalComposerContext()
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)
  const [isStrikethrough, setIsStrikethrough] = useState(false)
  const [isCode, setIsCode] = useState(false)
  const [isLink, setIsLink] = useState(false)
  const selectedTextRef = useRef('')

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

    selectedTextRef.current = selection.getTextContent()
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

  // Auto-track scroll/resize
  useEffect(() => {
    if (!isVisible) {
      cleanupRef.current?.()
      cleanupRef.current = null
      return
    }

    const toolbar = toolbarRef.current
    const rootEl = editor.getRootElement()
    if (!toolbar || !rootEl) return

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

  const handleInsertLink = useCallback(() => {
    if (isLink) {
      // Already a link — remove it
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
    } else {
      // Create placeholder link, then signal edit mode
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, 'https://')
      onInsertLink?.()
    }
  }, [editor, isLink, onInsertLink])

  const aiBtnRef = useRef<HTMLButtonElement>(null)

  const handleSelectionAction = useCallback(() => {
    const text = selectedTextRef.current
    if (!text || !onSelectionAction) return
    const btn = aiBtnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    onSelectionAction(text, {
      left:   rect.left,
      top:    rect.top,
      right:  rect.right,
      bottom: rect.bottom,
    })
    setIsVisible(false)
  }, [onSelectionAction])

  const handleAskChat = useCallback(() => {
    const text = selectedTextRef.current
    if (text && onAskChat) {
      onAskChat(text)
      setIsVisible(false)
    }
  }, [onAskChat])

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
    has('link') && <ToolbarBtn key="link" active={isLink} onClick={handleInsertLink} label="🔗" title="Link" />,
  ].filter(Boolean)

  const showAiBtn   = !!onSelectionAction
  const showChatBtn = !!onAskChat
  const hasAnyAi    = showAiBtn || showChatBtn

  return createPortal(
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-0.5 bg-popover border border-border rounded-lg shadow-lg p-1"
    >
      {formatBtns}
      {formatBtns.length > 0 && extraBtns.length > 0 && <div className="w-px h-5 bg-border mx-0.5" />}
      {extraBtns}
      {hasAnyAi && (formatBtns.length > 0 || extraBtns.length > 0) && <div className="w-px h-5 bg-border mx-0.5" />}
      {showAiBtn && (
        <button
          ref={aiBtnRef}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); handleSelectionAction() }}
          title="AI actions on selection"
          className="px-2 py-1 rounded text-sm transition-colors hover:bg-accent/50 text-primary"
        >
          ✦
        </button>
      )}
      {showChatBtn && (
        <ToolbarBtn key="chat" active={false} onClick={handleAskChat} label="💬" title="Discuss selection in chat" />
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
