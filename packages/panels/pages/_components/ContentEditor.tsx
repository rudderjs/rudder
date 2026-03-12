import { useRef } from 'react'
import type { ContentBlockDef, NodeData, NodeMap } from '@boostkit/panels'
import { contentBlockDefs, ensureNodeMap, addNode, updateNodeProps, removeNode, reorderNode } from '@boostkit/panels'
import { RichTextBlock } from './content-blocks/RichTextBlock.js'
import { ImageBlock } from './content-blocks/ImageBlock.js'
import { CodeBlock } from './content-blocks/CodeBlock.js'
import { DividerBlock } from './content-blocks/DividerBlock.js'
import { ListBlock } from './content-blocks/ListBlock.js'
import { BlockPicker } from './content-blocks/BlockPicker.js'
import { InlineToolbar } from './content-blocks/InlineToolbar.js'
import { SortableBlockList } from './SortableBlockList.js'

const defaultBlockProps: Record<string, Record<string, unknown>> = {
  paragraph: { text: '' },
  heading:   { text: '', level: 2 },
  image:     { src: '', alt: '', caption: '' },
  divider:   {},
  code:      { code: '', language: '' },
  quote:     { text: '' },
  list:      { style: 'bullet', items: [''] },
}

interface Props {
  value:          unknown
  onChange:       (value: NodeMap) => void
  allowedBlocks?: string[]
  placeholder?:   string
  maxBlocks?:     number
  uploadBase?:    string
  disabled?:      boolean
}

export function ContentEditor({ value: rawValue, onChange, allowedBlocks, placeholder, maxBlocks, uploadBase, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const value   = ensureNodeMap(rawValue)
  const root    = value.ROOT!
  const nodeIds = root.nodes
  const defs    = contentBlockDefs.filter(d => !allowedBlocks || allowedBlocks.includes(d.type))
  const atMax   = maxBlocks !== undefined && nodeIds.length >= maxBlocks

  function handleAddBlock(type: string, atIndex?: number) {
    const props = defaultBlockProps[type]
    if (!props || atMax) return
    const { map } = addNode(value, type, { ...props }, 'ROOT', atIndex)
    onChange(map)
  }

  function handleUpdateNode(id: string, propsPatch: Record<string, unknown>) {
    onChange(updateNodeProps(value, id, propsPatch))
  }

  function handleRemoveNode(id: string) {
    onChange(removeNode(value, id))
  }

  function handleReorder(id: string, fromIndex: number, toIndex: number) {
    onChange(reorderNode(value, id, fromIndex, toIndex))
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1 min-h-[200px] rounded-lg border border-input bg-background p-3 pl-12">
      <InlineToolbar containerRef={containerRef} />

      {nodeIds.length === 0 && !disabled && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <BlockPicker defs={defs} onSelect={(type) => handleAddBlock(type)} trigger="empty" placeholder={placeholder} />
        </div>
      )}

      <SortableBlockList
        nodeIds={nodeIds}
        onReorder={handleReorder}
        disabled={disabled}
        renderNode={(id, index) => {
          const node = value[id]
          if (!node) return null
          return (
            <div className="group/content-block relative">
              {!disabled && (
                <div className="absolute right-1 top-0 opacity-0 group-hover/content-block:opacity-100 transition-opacity z-10">
                  <button type="button" onClick={() => handleRemoveNode(id)}
                    className="text-xs text-destructive hover:text-destructive/80 p-0.5">&times;</button>
                </div>
              )}

              {renderBlock(node, (patch) => handleUpdateNode(id, patch), uploadBase, disabled)}

              {!disabled && !atMax && (
                <div className="h-0 relative">
                  <div className="absolute inset-x-0 -top-0.5 flex justify-center opacity-0 group-hover/content-block:opacity-100 transition-opacity z-10">
                    <BlockPicker defs={defs} onSelect={(type) => handleAddBlock(type, index + 1)} trigger="between" />
                  </div>
                </div>
              )}
            </div>
          )
        }}
      />

      {nodeIds.length > 0 && !disabled && !atMax && (
        <div className="flex justify-center pt-2">
          <BlockPicker defs={defs} onSelect={(type) => handleAddBlock(type)} trigger="bottom" />
        </div>
      )}
    </div>
  )
}

function renderBlock(
  node: NodeData,
  updateProps: (patch: Record<string, unknown>) => void,
  uploadBase?: string,
  disabled?: boolean,
) {
  const p = node.props

  switch (node.type) {
    case 'paragraph':
      return <RichTextBlock text={(p.text as string) ?? ''} onChange={(text) => updateProps({ text })} tag="p" disabled={disabled} />
    case 'heading':
      return (
        <div className="flex items-center gap-2">
          <select
            value={(p.level as number) ?? 2}
            onChange={(e) => updateProps({ level: Number(e.target.value) })}
            className="text-xs border rounded px-1 py-0.5 bg-background"
            disabled={disabled}
          >
            <option value={1}>H1</option>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
          <div className="flex-1">
            <RichTextBlock text={(p.text as string) ?? ''} onChange={(text) => updateProps({ text })} tag={`h${p.level ?? 2}` as 'h1' | 'h2' | 'h3'} disabled={disabled} />
          </div>
        </div>
      )
    case 'quote':
      return (
        <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic">
          <RichTextBlock text={(p.text as string) ?? ''} onChange={(text) => updateProps({ text })} tag="p" disabled={disabled} />
        </blockquote>
      )
    case 'image':
      return <ImageBlock src={(p.src as string) ?? ''} alt={(p.alt as string) ?? ''} caption={(p.caption as string) ?? ''} onChange={updateProps} uploadBase={uploadBase} disabled={disabled} />
    case 'code':
      return <CodeBlock code={(p.code as string) ?? ''} language={(p.language as string) ?? ''} onChange={updateProps} disabled={disabled} />
    case 'divider':
      return <DividerBlock />
    case 'list':
      return <ListBlock style={(p.style as 'bullet' | 'numbered') ?? 'bullet'} items={Array.isArray(p.items) ? (p.items as string[]) : ['']} onChange={updateProps} disabled={disabled} />
    default:
      return <div className="text-xs text-muted-foreground py-2">Unknown block: {node.type}</div>
  }
}
