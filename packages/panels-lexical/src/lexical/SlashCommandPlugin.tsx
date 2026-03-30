import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text'
import { $getSelection, $isRangeSelection } from 'lexical'
import type { LexicalEditor } from 'lexical'
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from '@lexical/list'
import { $createCodeNode } from '@lexical/code'
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode'
import { computePosition, flip, shift, offset, size, autoUpdate } from '@floating-ui/dom'

// ── Menu option class ───────────────────────────────────────

class SlashMenuOption extends MenuOption {
  title: string
  icon: string
  description: string
  group?: string | undefined
  onSelect: (editor: LexicalEditor) => void

  constructor(
    title: string,
    opts: { icon: string; description: string; group?: string; onSelect: (editor: LexicalEditor) => void },
  ) {
    super(title)
    this.title = title
    this.icon = opts.icon
    this.description = opts.description
    this.group = opts.group
    this.onSelect = opts.onSelect
  }
}

// ── Default items ───────────────────────────────────────────

function getDefaultOptions(): SlashMenuOption[] {
  return [
    new SlashMenuOption('Heading 1', {
      icon: 'H1', description: 'Large heading', group: 'Basic',
      onSelect: (editor) => editor.update(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.insertNodes([$createHeadingNode('h1')])
      }),
    }),
    new SlashMenuOption('Heading 2', {
      icon: 'H2', description: 'Medium heading', group: 'Basic',
      onSelect: (editor) => editor.update(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.insertNodes([$createHeadingNode('h2')])
      }),
    }),
    new SlashMenuOption('Heading 3', {
      icon: 'H3', description: 'Small heading', group: 'Basic',
      onSelect: (editor) => editor.update(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.insertNodes([$createHeadingNode('h3')])
      }),
    }),
    new SlashMenuOption('Bullet List', {
      icon: '•', description: 'Unordered list', group: 'Lists',
      onSelect: (editor) => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
    }),
    new SlashMenuOption('Numbered List', {
      icon: '1.', description: 'Ordered list', group: 'Lists',
      onSelect: (editor) => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
    }),
    new SlashMenuOption('Quote', {
      icon: '"', description: 'Block quote', group: 'Basic',
      onSelect: (editor) => editor.update(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.insertNodes([$createQuoteNode()])
      }),
    }),
    new SlashMenuOption('Code Block', {
      icon: '</>', description: 'Code snippet', group: 'Basic',
      onSelect: (editor) => editor.update(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.insertNodes([$createCodeNode()])
      }),
    }),
    new SlashMenuOption('Divider', {
      icon: '—', description: 'Horizontal rule', group: 'Basic',
      onSelect: (editor) => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
    }),
  ]
}

// ── Plugin component ────────────────────────────────────────

interface Props {
  /** Additional slash menu items (e.g. custom blocks) */
  extraItems?: SlashMenuOption[] | undefined
}

export function SlashCommandPlugin({ extraItems }: Props) {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', {
    minLength: 0,
  })

  const options = useMemo(() => {
    const all = [...getDefaultOptions(), ...(extraItems ?? [])]
    if (!queryString) return all
    const q = queryString.toLowerCase()
    return all.filter(opt =>
      opt.title.toLowerCase().includes(q) ||
      opt.description.toLowerCase().includes(q) ||
      (opt.group?.toLowerCase().includes(q))
    )
  }, [queryString, extraItems])

  const onSelectOption = useCallback(
    (option: SlashMenuOption, textNodeContainingQuery: { remove(): void } | null, closeMenu: () => void) => {
      editor.update(() => {
        if (textNodeContainingQuery) textNodeContainingQuery.remove()
      })
      option.onSelect(editor)
      closeMenu()
    },
    [editor],
  )

  // Auto-position the menu with scroll/resize tracking
  const cleanupRef = useRef<(() => void) | null>(null)

  const startAutoPosition = useCallback((anchorEl: HTMLElement) => {
    // Clean up previous auto-update
    cleanupRef.current?.()

    const menu = menuRef.current
    if (!menu) return

    // Capture the selection range once when the menu opens — don't re-read on
    // every scroll/resize update, otherwise clicking outside moves the popover.
    const sel = window.getSelection()
    const openRange = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null
    const reference = openRange
      ? { getBoundingClientRect: () => openRange.getBoundingClientRect() } as Element
      : anchorEl

    const updatePosition = () => {

      computePosition(reference, menu, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [
          offset(2),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ availableHeight }) {
              if (menu) {
                menu.style.maxHeight = `${Math.min(300, Math.max(120, availableHeight))}px`
              }
            },
          }),
        ],
      }).then(({ x, y }) => {
        menu.style.left = `${x}px`
        menu.style.top = `${y}px`
      })
    }

    // autoUpdate tracks scroll, resize, and ancestor layout changes
    cleanupRef.current = autoUpdate(anchorEl, menu, updatePosition)
  }, [])

  // Close menu on click outside
  const menuVisible = useRef(false)
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!menuVisible.current) return
      const menu = menuRef.current
      if (menu && !menu.contains(e.target as Node)) {
        // Click outside the menu — simulate Escape to dismiss the typeahead
        const rootEl = editor.getRootElement()
        if (rootEl) {
          rootEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        }
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [editor, queryString])

  // Clean up auto-update on unmount
  useEffect(() => () => { cleanupRef.current?.() }, [])

  return (
    <LexicalTypeaheadMenuPlugin<SlashMenuOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(anchorElementRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
        if (!anchorElementRef.current || options.length === 0) {
          cleanupRef.current?.()
          menuVisible.current = false
          return null
        }
        menuVisible.current = true

        // Schedule auto-positioning after portal renders
        requestAnimationFrame(() => {
          if (anchorElementRef.current) startAutoPosition(anchorElementRef.current)
        })

        return createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg overflow-y-auto w-[280px] p-1"
            style={{ maxHeight: '300px' }}
          >
            {options.map((option, i) => (
              <button
                key={option.key}
                type="button"
                ref={option.setRefElement}
                onClick={() => selectOptionAndCleanUp(option)}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={[
                  'flex items-center gap-3 w-full text-left px-3 py-2 rounded-md text-sm',
                  i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                ].join(' ')}
              >
                <span className="w-8 h-8 flex items-center justify-center rounded bg-muted text-xs font-mono shrink-0">
                  {option.icon}
                </span>
                <div className="min-w-0">
                  <div className="font-medium truncate">{option.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{option.description}</div>
                </div>
              </button>
            ))}
          </div>,
          document.body,
        )
      }}
    />
  )
}

export { SlashMenuOption }
