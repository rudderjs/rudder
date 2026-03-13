import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection, $isRangeSelection,
  FORMAT_TEXT_COMMAND, SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
} from 'lexical'
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { mergeRegister } from '@lexical/utils'

export function FloatingToolbarPlugin() {
  const [editor] = useLexicalComposerContext()
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)
  const [isStrikethrough, setIsStrikethrough] = useState(false)
  const [isCode, setIsCode] = useState(false)
  const [isLink, setIsLink] = useState(false)

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

    requestAnimationFrame(() => {
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
        middleware: [offset(8), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        toolbar.style.left = `${x}px`
        toolbar.style.top = `${y}px`
      })
    })
  }, [])

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

  const insertLink = useCallback(() => {
    if (isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
    } else {
      const url = prompt('URL:')
      if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)
    }
  }, [editor, isLink])

  if (!isVisible) return null

  return createPortal(
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-0.5 bg-popover border border-border rounded-lg shadow-lg p-1"
    >
      <ToolbarBtn active={isBold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} label="B" title="Bold" className="font-bold" />
      <ToolbarBtn active={isItalic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} label="I" title="Italic" className="italic" />
      <ToolbarBtn active={isUnderline} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')} label="U" title="Underline" className="underline" />
      <ToolbarBtn active={isStrikethrough} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')} label="S" title="Strikethrough" className="line-through" />
      <div className="w-px h-5 bg-border mx-0.5" />
      <ToolbarBtn active={isCode} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')} label="<>" title="Code" className="font-mono text-xs" />
      <ToolbarBtn active={isLink} onClick={insertLink} label="link" title="Link" />
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
