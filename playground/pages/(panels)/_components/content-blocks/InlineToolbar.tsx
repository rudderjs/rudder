import { useState, useEffect, useCallback, useRef } from 'react'
import { icons } from 'lucide-react'

const BoldIcon        = icons['Bold']!
const ItalicIcon      = icons['Italic']!
const UnderlineIcon   = icons['Underline']!
const StrikethroughIcon = icons['Strikethrough']!
const LinkIcon        = icons['Link']!
const UnlinkIcon      = icons['Unlink']!

interface ToolbarState {
  visible: boolean
  x: number
  y: number
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  link: boolean
}

export function InlineToolbar({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const [state, setState] = useState<ToolbarState>({
    visible: false, x: 0, y: 0,
    bold: false, italic: false, underline: false, strikethrough: false, link: false,
  })
  const toolbarRef = useRef<HTMLDivElement>(null)

  const checkSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setState(s => ({ ...s, visible: false }))
      return
    }

    const range = sel.getRangeAt(0)
    if (!containerRef.current?.contains(range.commonAncestorContainer)) {
      setState(s => ({ ...s, visible: false }))
      return
    }

    const rect = range.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()

    setState({
      visible: true,
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top - containerRect.top - 8,
      bold:          document.queryCommandState('bold'),
      italic:        document.queryCommandState('italic'),
      underline:     document.queryCommandState('underline'),
      strikethrough: document.queryCommandState('strikeThrough'),
      link:          !!findParentAnchor(sel.anchorNode),
    })
  }, [containerRef])

  useEffect(() => {
    document.addEventListener('selectionchange', checkSelection)
    return () => document.removeEventListener('selectionchange', checkSelection)
  }, [checkSelection])

  if (!state.visible) return null

  function exec(command: string) {
    document.execCommand(command, false)
    checkSelection()
  }

  function toggleLink() {
    if (state.link) {
      document.execCommand('unlink')
    } else {
      const url = prompt('Link URL:')
      if (url) document.execCommand('createLink', false, url)
    }
    checkSelection()
  }

  const btnCls = (active: boolean) => [
    'p-1.5 rounded transition-colors',
    active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-foreground',
  ].join(' ')

  return (
    <div
      ref={toolbarRef}
      className="absolute z-50 flex items-center gap-0.5 rounded-lg border bg-popover shadow-lg px-1 py-0.5 -translate-x-1/2 -translate-y-full"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" className={btnCls(state.bold)} onClick={() => exec('bold')} title="Bold (⌘B)">
        <BoldIcon className="size-3.5" />
      </button>
      <button type="button" className={btnCls(state.italic)} onClick={() => exec('italic')} title="Italic (⌘I)">
        <ItalicIcon className="size-3.5" />
      </button>
      <button type="button" className={btnCls(state.underline)} onClick={() => exec('underline')} title="Underline (⌘U)">
        <UnderlineIcon className="size-3.5" />
      </button>
      <button type="button" className={btnCls(state.strikethrough)} onClick={() => exec('strikeThrough')} title="Strikethrough">
        <StrikethroughIcon className="size-3.5" />
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button type="button" className={btnCls(state.link)} onClick={toggleLink} title={state.link ? 'Unlink' : 'Link (⌘K)'}>
        {state.link ? <UnlinkIcon className="size-3.5" /> : <LinkIcon className="size-3.5" />}
      </button>
    </div>
  )
}

function findParentAnchor(node: Node | null): HTMLAnchorElement | null {
  while (node) {
    if (node instanceof HTMLAnchorElement) return node
    node = node.parentNode
  }
  return null
}
