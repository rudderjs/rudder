import { useRef } from 'react'
import type { NodeData, NodeMap, ContentBlockDef } from '@boostkit/panels'
import { addNode, removeNode, removeNodeRecursive, reorderNode } from '@boostkit/panels'
import { RichTextBlock } from './RichTextBlock.js'
import { SortableBlockList } from '../SortableBlockList.js'

interface Props {
  node:             NodeData
  nodeId:           string
  nodeMap:          NodeMap
  onChange:         (map: NodeMap) => void
  renderBlock:      (node: NodeData, nodeId: string, updateProps: (patch: Record<string, unknown>) => void, map: NodeMap) => React.ReactNode
  defs:             ContentBlockDef[]
  defaultBlockProps: Record<string, Record<string, unknown>>
  disabled?:        boolean
  /** Slash command handler from ContentEditor */
  onSlashCommand?:  (blockId: string, parentId: string, position: { top: number; left: number }) => void
  /** Slash menu state from ContentEditor */
  slashBlockId?:    string | null
  slashNavigate?:   (delta: number) => void
  slashSelect?:     () => void
  slashClose?:      () => void
  slashQueryChange?:(query: string) => void
}

export function ListBlock({ node, nodeId, nodeMap, onChange, disabled, onSlashCommand, slashBlockId, slashNavigate, slashSelect, slashClose, slashQueryChange }: Props) {
  const style    = (node.props.style as 'bullet' | 'numbered') ?? 'bullet'
  const itemIds  = node.nodes
  const initRef  = useRef(false)

  // Legacy migration: if list has no child nodes but has `items` prop, migrate
  if (!initRef.current && itemIds.length === 0) {
    initRef.current = true
    const legacyItems = Array.isArray(node.props.items) ? (node.props.items as string[]) : ['']
    let map = nodeMap
    for (const text of legacyItems) {
      const result = addNode(map, 'list-item', { text: text || '' }, nodeId)
      map = result.map
    }
    onChange(map)
    return null
  }
  initRef.current = true

  function toggleStyle() {
    const updated = { ...nodeMap }
    updated[nodeId] = { ...node, props: { ...node.props, style: style === 'bullet' ? 'numbered' : 'bullet' } }
    onChange(updated)
  }

  function updateItemText(itemId: string, text: string) {
    const item = nodeMap[itemId]
    if (!item) return
    onChange({ ...nodeMap, [itemId]: { ...item, props: { ...item.props, text } } })
  }

  function addItemAfter(afterIndex: number) {
    const { map, id: newId } = addNode(nodeMap, 'list-item', { text: '' }, nodeId, afterIndex + 1)
    onChange(map)
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-list-item-id="${newId}"] [contenteditable]`) as HTMLElement
      el?.focus()
    })
  }

  function removeItem(itemId: string) {
    const item = nodeMap[itemId]
    if (!item) return
    if (item.nodes.length > 0) {
      onChange(removeNodeRecursive(nodeMap, itemId))
    } else {
      onChange(removeNode(nodeMap, itemId))
    }
  }

  function handleDeleteItem(itemId: string, itemIndex: number) {
    if (itemIds.length <= 1) return
    const prevId = itemIndex > 0 ? itemIds[itemIndex - 1] : null
    removeItem(itemId)
    if (prevId) {
      requestAnimationFrame(() => {
        const prevEl = document.querySelector(`[data-list-item-id="${prevId}"] [contenteditable]`) as HTMLElement
        if (prevEl) {
          prevEl.focus()
          const sel = window.getSelection()
          if (sel) {
            const range = document.createRange()
            range.selectNodeContents(prevEl)
            range.collapse(false)
            sel.removeAllRanges()
            sel.addRange(range)
          }
        }
      })
    }
  }

  function handleNewItemAfter(itemId: string) {
    const itemIndex = itemIds.indexOf(itemId)
    if (itemIndex === -1) return
    addItemAfter(itemIndex)
  }

  function handleItemSlashCommand(itemId: string, position: { top: number; left: number }) {
    onSlashCommand?.(itemId, nodeId, position)
  }

  function handleReorder(id: string, fromIndex: number, toIndex: number) {
    onChange(reorderNode(nodeMap, id, fromIndex, toIndex))
  }

  function indentItem(itemId: string, itemIndex: number) {
    if (itemIndex === 0) return
    const prevId = itemIds[itemIndex - 1]!
    const prevItem = nodeMap[prevId]!

    const existingSublist = prevItem.nodes.find(id => nodeMap[id]?.type === 'list')
    let map = { ...nodeMap }

    if (existingSublist) {
      const sublist = map[existingSublist]!
      map[existingSublist] = { ...sublist, nodes: [...sublist.nodes, itemId] }
    } else {
      const result = addNode(map, 'list', { style }, prevId)
      map = result.map
      const sublistId = result.id
      map[sublistId] = { ...map[sublistId]!, nodes: [itemId] }
    }

    const parentNode = map[nodeId]!
    map[nodeId] = { ...parentNode, nodes: parentNode.nodes.filter(id => id !== itemId) }
    const sublistId = existingSublist ?? Object.keys(map).find(k => map[k]!.nodes.includes(itemId) && k !== nodeId)!
    map[itemId] = { ...map[itemId]!, parent: sublistId }
    onChange(map)
  }

  function outdentItem(itemId: string) {
    const thisList = nodeMap[nodeId]
    if (!thisList) return
    const parentItem = nodeMap[thisList.parent]
    if (!parentItem) return
    const grandparentList = nodeMap[parentItem.parent]
    if (!grandparentList || grandparentList.type !== 'list') return

    let map = { ...nodeMap }

    const sublistNode = map[nodeId]!
    map[nodeId] = { ...sublistNode, nodes: sublistNode.nodes.filter(id => id !== itemId) }

    const gpNode = map[parentItem.parent]!
    const parentItemIndex = gpNode.nodes.indexOf(thisList.parent)
    const newNodes = [...gpNode.nodes]
    newNodes.splice(parentItemIndex + 1, 0, itemId)
    map[parentItem.parent] = { ...gpNode, nodes: newNodes }

    map[itemId] = { ...map[itemId]!, parent: parentItem.parent }

    if (map[nodeId]!.nodes.length === 0) {
      const pItem = map[thisList.parent]!
      map[thisList.parent] = { ...pItem, nodes: pItem.nodes.filter(id => id !== nodeId) }
      delete map[nodeId]
    }

    onChange(map)
  }

  const Tag = style === 'numbered' ? 'ol' : 'ul'

  return (
    <div className="flex items-start gap-2" data-list-id={nodeId}>
      <button
        type="button"
        onClick={toggleStyle}
        className="text-xs text-muted-foreground hover:text-foreground mt-1.5 shrink-0"
        disabled={disabled}
      >
        {style === 'bullet' ? '•' : '1.'}
      </button>
      <Tag className={`flex-1 flex flex-col gap-0.5 ${style === 'numbered' ? 'list-decimal' : 'list-disc'} pl-5`}>
        <SortableBlockList
          nodeIds={itemIds}
          onReorder={handleReorder}
          disabled={disabled}
          renderNode={(itemId, i) => {
            const item = nodeMap[itemId]
            if (!item || item.type !== 'list-item') return null
            const sublistId = item.nodes.find(id => nodeMap[id]?.type === 'list')
            return (
              <li data-list-item-id={itemId}>
                <RichTextBlock
                  text={(item.props.text as string) ?? ''}
                  onChange={(text) => updateItemText(itemId, text)}
                  tag="p"
                  disabled={disabled}
                  placeholder="List item..."
                  onSlashCommand={(pos) => handleItemSlashCommand(itemId, pos)}
                  onNewBlockAfter={() => handleNewItemAfter(itemId)}
                  onDeleteBlock={() => handleDeleteItem(itemId, i)}
                  slashMenuActive={slashBlockId === itemId}
                  onSlashNavigate={slashNavigate}
                  onSlashSelect={slashSelect}
                  onSlashClose={slashClose}
                  onSlashQueryChange={slashQueryChange}
                  onTab={(shiftKey) => shiftKey ? outdentItem(itemId) : indentItem(itemId, i)}
                  enterCreatesBlock
                />
                {sublistId && nodeMap[sublistId] && (
                  <ListBlock
                    node={nodeMap[sublistId]!}
                    nodeId={sublistId}
                    nodeMap={nodeMap}
                    onChange={onChange}
                    renderBlock={() => null}
                    defs={[]}
                    defaultBlockProps={{}}
                    disabled={disabled}
                    onSlashCommand={onSlashCommand}
                    slashBlockId={slashBlockId}
                    slashNavigate={slashNavigate}
                    slashSelect={slashSelect}
                    slashClose={slashClose}
                    slashQueryChange={slashQueryChange}
                  />
                )}
              </li>
            )
          }}
        />
      </Tag>
    </div>
  )
}
