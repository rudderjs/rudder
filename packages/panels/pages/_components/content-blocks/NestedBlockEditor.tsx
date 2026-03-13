import type { NodeData, NodeMap, ContentBlockDef } from '@boostkit/panels'
import { addNode, removeNode, removeNodeRecursive, reorderNode } from '@boostkit/panels'
import { BlockPicker } from './BlockPicker.js'
import { SortableBlockList } from '../SortableBlockList.js'

interface Props {
  /** Full NodeMap (shared with parent ContentEditor) */
  nodeMap:      NodeMap
  /** ID of this container node (table cell, list item, etc.) */
  parentId:     string
  /** Callback to update the entire NodeMap */
  onChange:     (map: NodeMap) => void
  /** Render function for a single block node — passed from ContentEditor */
  renderBlock:  (node: NodeData, nodeId: string, updateProps: (patch: Record<string, unknown>) => void, map: NodeMap) => React.ReactNode
  /** Available block definitions */
  defs:         ContentBlockDef[]
  /** Default props for new blocks keyed by type */
  defaultBlockProps: Record<string, Record<string, unknown>>
  disabled?:    boolean
  /** Max child blocks in this container */
  maxBlocks?:   number
  /** Placeholder when empty */
  placeholder?: string
}

export function NestedBlockEditor({
  nodeMap, parentId, onChange, renderBlock, defs, defaultBlockProps, disabled, maxBlocks, placeholder,
}: Props) {
  const parent  = nodeMap[parentId]
  if (!parent) return null
  const childIds = parent.nodes
  const atMax    = maxBlocks !== undefined && childIds.length >= maxBlocks

  function handleAdd(type: string, atIndex?: number) {
    const props = defaultBlockProps[type]
    if (!props || atMax) return
    const { map } = addNode(nodeMap, type, { ...props }, parentId, atIndex)
    onChange(map)
  }

  function handleRemove(id: string) {
    // Use recursive remove for container blocks that may have children
    const node = nodeMap[id]
    if (node && node.nodes.length > 0) {
      onChange(removeNodeRecursive(nodeMap, id))
    } else {
      onChange(removeNode(nodeMap, id))
    }
  }

  function handleReorder(id: string, fromIndex: number, toIndex: number) {
    onChange(reorderNode(nodeMap, id, fromIndex, toIndex))
  }

  function handleUpdateProps(id: string, patch: Record<string, unknown>) {
    const node = nodeMap[id]
    if (!node) return
    onChange({
      ...nodeMap,
      [id]: { ...node, props: { ...node.props, ...patch } },
    })
  }

  if (childIds.length === 0 && !disabled) {
    return (
      <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
        <BlockPicker defs={defs} onSelect={(type) => handleAdd(type)} trigger="empty" placeholder={placeholder ?? 'Add content...'} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5 min-h-[1.5em]">
      {childIds.map((id, index) => {
        const node = nodeMap[id]
        if (!node) return null
        return (
          <div key={id} className="group/nested-block relative">
            {!disabled && (
              <div className="absolute right-0 top-0 opacity-0 group-hover/nested-block:opacity-100 transition-opacity z-10">
                <button type="button" onClick={() => handleRemove(id)}
                  className="text-xs text-destructive hover:text-destructive/80 p-0.5">&times;</button>
              </div>
            )}
            {renderBlock(node, id, (patch) => handleUpdateProps(id, patch), nodeMap)}
            {!disabled && !atMax && index < childIds.length - 1 && (
              <div className="h-0 relative">
                <div className="absolute inset-x-0 flex justify-center opacity-0 group-hover/nested-block:opacity-100 transition-opacity z-10">
                  <BlockPicker defs={defs} onSelect={(type) => handleAdd(type, index + 1)} trigger="between" />
                </div>
              </div>
            )}
          </div>
        )
      })}
      {!disabled && !atMax && (
        <div className="flex justify-center pt-1">
          <BlockPicker defs={defs} onSelect={(type) => handleAdd(type)} trigger="bottom" />
        </div>
      )}
    </div>
  )
}
