import { useCallback, useMemo, useState } from 'react'
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

// ── Menu option class ───────────────────────────────────────

class SlashMenuOption extends MenuOption {
  title: string
  icon: string
  description: string
  onSelect: (editor: LexicalEditor) => void

  constructor(
    title: string,
    opts: { icon: string; description: string; onSelect: (editor: LexicalEditor) => void },
  ) {
    super(title)
    this.title = title
    this.icon = opts.icon
    this.description = opts.description
    this.onSelect = opts.onSelect
  }
}

// ── Default items ───────────────────────────────────────────

function getDefaultOptions(editor: LexicalEditor): SlashMenuOption[] {
  return [
    new SlashMenuOption('Heading 1', {
      icon: 'H1', description: 'Large heading',
      onSelect: () => editor.update(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.insertNodes([$createHeadingNode('h1')])
      }),
    }),
    new SlashMenuOption('Heading 2', {
      icon: 'H2', description: 'Medium heading',
      onSelect: () => editor.update(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.insertNodes([$createHeadingNode('h2')])
      }),
    }),
    new SlashMenuOption('Heading 3', {
      icon: 'H3', description: 'Small heading',
      onSelect: () => editor.update(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.insertNodes([$createHeadingNode('h3')])
      }),
    }),
    new SlashMenuOption('Bullet List', {
      icon: '•', description: 'Unordered list',
      onSelect: () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
    }),
    new SlashMenuOption('Numbered List', {
      icon: '1.', description: 'Ordered list',
      onSelect: () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
    }),
    new SlashMenuOption('Quote', {
      icon: '"', description: 'Block quote',
      onSelect: () => editor.update(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.insertNodes([$createQuoteNode()])
      }),
    }),
    new SlashMenuOption('Code Block', {
      icon: '</>', description: 'Code snippet',
      onSelect: () => editor.update(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.insertNodes([$createCodeNode()])
      }),
    }),
    new SlashMenuOption('Divider', {
      icon: '—', description: 'Horizontal rule',
      onSelect: () => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
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

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', {
    minLength: 0,
  })

  const options = useMemo(() => {
    const all = [...getDefaultOptions(editor), ...(extraItems ?? [])]
    if (!queryString) return all
    return all.filter(opt =>
      opt.title.toLowerCase().includes(queryString.toLowerCase()),
    )
  }, [editor, queryString, extraItems])

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

  return (
    <LexicalTypeaheadMenuPlugin<SlashMenuOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(anchorElementRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
        if (!anchorElementRef.current || options.length === 0) return null
        return createPortal(
          <div className="z-50 bg-popover border border-border rounded-lg shadow-lg overflow-y-auto max-h-[300px] w-[280px] p-1">
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
          anchorElementRef.current,
        )
      }}
    />
  )
}

export { SlashMenuOption }
