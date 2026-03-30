import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection, $isRangeSelection, $isElementNode,
  FORMAT_TEXT_COMMAND, SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW, UNDO_COMMAND, REDO_COMMAND,
  INDENT_CONTENT_COMMAND, OUTDENT_CONTENT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  CAN_UNDO_COMMAND, CAN_REDO_COMMAND,
} from 'lexical'
import { $isHeadingNode, $createHeadingNode, $createQuoteNode, type HeadingTagType } from '@lexical/rich-text'
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from '@lexical/list'
import { $createCodeNode } from '@lexical/code'
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode'
import { mergeRegister } from '@lexical/utils'
import { $createParagraphNode } from 'lexical'
import type { ToolbarConfig, ToolbarTool } from '../toolbar.js'
import { hasTool, hasHeadingTool } from '../toolbar.js'

/** Get the top-level element node from the current selection. */
function getSelectedElement(selection: ReturnType<typeof $getSelection>) {
  if (!$isRangeSelection(selection)) return null
  const anchor = selection.anchor.getNode()
  const element = anchor.getKey() === 'root' ? anchor : anchor.getTopLevelElementOrThrow()
  return $isElementNode(element) ? element : null
}

interface Props {
  config: ToolbarConfig
}

export function FixedToolbarPlugin({ config }: Props) {
  const [editor] = useLexicalComposerContext()
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)
  const [isStrikethrough, setIsStrikethrough] = useState(false)
  const [isCode, setIsCode] = useState(false)
  const [isLink, setIsLink] = useState(false)
  const [blockType, setBlockType] = useState('paragraph')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [textAlign, setTextAlign] = useState<string>('left')

  const updateToolbar = useCallback(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return

    setIsBold(selection.hasFormat('bold'))
    setIsItalic(selection.hasFormat('italic'))
    setIsUnderline(selection.hasFormat('underline'))
    setIsStrikethrough(selection.hasFormat('strikethrough'))
    setIsCode(selection.hasFormat('code'))

    const node = selection.anchor.getNode()
    const parent = node.getParent()
    setIsLink($isLinkNode(parent) || $isLinkNode(node))

    // Detect current block type
    const anchorNode = selection.anchor.getNode()
    const element = anchorNode.getKey() === 'root' ? anchorNode : anchorNode.getTopLevelElementOrThrow()
    if ($isHeadingNode(element)) {
      setBlockType(element.getTag())
    } else {
      setBlockType(element.getType())
    }

    // Detect text alignment
    const format = element.getFormat?.()
    const alignMap: Record<number, string> = { 0: 'left', 1: 'left', 2: 'center', 3: 'right', 4: 'justify' }
    setTextAlign(typeof format === 'number' ? (alignMap[format] ?? 'left') : 'left')
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
      editor.registerCommand(CAN_UNDO_COMMAND, (payload) => { setCanUndo(payload); return false }, COMMAND_PRIORITY_LOW),
      editor.registerCommand(CAN_REDO_COMMAND, (payload) => { setCanRedo(payload); return false }, COMMAND_PRIORITY_LOW),
    )
  }, [editor, updateToolbar])

  const formatHeading = useCallback((tag: HeadingTagType) => {
    editor.update(() => {
      const element = getSelectedElement($getSelection())
      if (!element) return
      if (blockType === tag) {
        const paragraph = $createParagraphNode()
        paragraph.append(...element.getChildren())
        element.replace(paragraph)
      } else {
        const heading = $createHeadingNode(tag)
        heading.append(...element.getChildren())
        element.replace(heading)
      }
    })
  }, [editor, blockType])

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

  const submitLink = useCallback((e?: FormEvent) => {
    e?.preventDefault()
    if (linkUrl.trim()) {
      const url = linkUrl.trim().startsWith('http') ? linkUrl.trim() : `https://${linkUrl.trim()}`
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)
    }
    setLinkMode(false)
    setLinkUrl('')
  }, [editor, linkUrl])

  const has = (tool: ToolbarTool) => hasTool(config, tool)

  return (
    <div className="flex items-center gap-0.5 flex-wrap border-b border-border px-2 py-1 bg-muted/30">
      {/* Undo / Redo */}
      {(has('undo') || has('redo')) && (
        <>
          {has('undo') && <ToolbarBtn onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)} label="↩" title="Undo" disabled={!canUndo} />}
          {has('redo') && <ToolbarBtn onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)} label="↪" title="Redo" disabled={!canRedo} />}
          <Separator />
        </>
      )}

      {/* Heading dropdown */}
      {hasHeadingTool(config) && (
        <>
          <select
            value={blockType}
            onChange={(e) => {
              const val = e.target.value
              if (val === 'paragraph') {
                editor.update(() => {
                  const element = getSelectedElement($getSelection())
                  if (!element) return
                  const paragraph = $createParagraphNode()
                  paragraph.append(...element.getChildren())
                  element.replace(paragraph)
                })
              } else {
                formatHeading(val as HeadingTagType)
              }
            }}
            className="h-7 rounded border border-border bg-background px-2 text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="paragraph">Normal</option>
            {(has('heading') || has('h1')) && <option value="h1">Heading 1</option>}
            {(has('heading') || has('h2')) && <option value="h2">Heading 2</option>}
            {(has('heading') || has('h3')) && <option value="h3">Heading 3</option>}
          </select>
          <Separator />
        </>
      )}

      {/* Text formatting */}
      {has('bold') && <ToolbarBtn active={isBold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} label="B" title="Bold (⌘B)" className="font-bold" />}
      {has('italic') && <ToolbarBtn active={isItalic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} label="I" title="Italic (⌘I)" className="italic" />}
      {has('underline') && <ToolbarBtn active={isUnderline} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')} label="U" title="Underline (⌘U)" className="underline" />}
      {has('strikethrough') && <ToolbarBtn active={isStrikethrough} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')} label="S" title="Strikethrough" className="line-through" />}

      {(has('bold') || has('italic') || has('underline') || has('strikethrough')) && (has('code') || has('link')) && <Separator />}

      {has('code') && <ToolbarBtn active={isCode} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')} label="<>" title="Inline Code" className="font-mono text-xs" />}
      {has('link') && <ToolbarBtn active={isLink || linkMode} onClick={toggleLink} label="🔗" title="Link" />}
      {linkMode && (
        <form className="flex items-center gap-1 ml-1" onSubmit={submitLink}>
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
      )}

      {/* Alignment */}
      {has('align') && (
        <>
          <Separator />
          <ToolbarBtn active={textAlign === 'left'} onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'left')} label="≡" title="Align Left" />
          <ToolbarBtn active={textAlign === 'center'} onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'center')} label="≡" title="Align Center" className="text-center" />
          <ToolbarBtn active={textAlign === 'right'} onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'right')} label="≡" title="Align Right" className="text-right" />
        </>
      )}

      {/* Lists */}
      {(has('bulletList') || has('orderedList')) && (
        <>
          <Separator />
          {has('bulletList') && <ToolbarBtn onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)} label="•" title="Bullet List" />}
          {has('orderedList') && <ToolbarBtn onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)} label="1." title="Numbered List" />}
        </>
      )}

      {/* Indent */}
      {has('indent') && (
        <>
          <ToolbarBtn onClick={() => editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined)} label="→" title="Indent" />
          <ToolbarBtn onClick={() => editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)} label="←" title="Outdent" />
        </>
      )}

      {/* Block elements */}
      {(has('blockquote') || has('codeBlock') || has('divider')) && (
        <>
          <Separator />
          {has('blockquote') && <ToolbarBtn onClick={() => editor.update(() => {
            const element = getSelectedElement($getSelection())
            if (element) {
              const quote = $createQuoteNode()
              quote.append(...element.getChildren())
              element.replace(quote)
            }
          })} label="❝" title="Block Quote" />}
          {has('codeBlock') && <ToolbarBtn onClick={() => editor.update(() => {
            const sel = $getSelection()
            if ($isRangeSelection(sel)) sel.insertNodes([$createCodeNode()])
          })} label="{}" title="Code Block" className="font-mono text-xs" />}
          {has('divider') && <ToolbarBtn onClick={() => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)} label="—" title="Divider" />}
        </>
      )}
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────

function ToolbarBtn({ active, onClick, label, title, className, disabled }: {
  active?: boolean; onClick: () => void; label: string; title: string; className?: string; disabled?: boolean
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      disabled={disabled}
      className={[
        'w-7 h-7 inline-flex items-center justify-center rounded text-xs transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
        disabled ? 'opacity-30 cursor-not-allowed' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {label}
    </button>
  )
}

function Separator() {
  return <div className="w-px h-5 bg-border mx-0.5" />
}
