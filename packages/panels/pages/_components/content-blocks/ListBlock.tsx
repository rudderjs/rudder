import { useRef } from 'react'
import type { NodeData, NodeMap, ContentBlockDef } from '@boostkit/panels'
import { addNode, removeNode, removeNodeRecursive } from '@boostkit/panels'

interface Props {
  node:             NodeData
  nodeId:           string
  nodeMap:          NodeMap
  onChange:         (map: NodeMap) => void
  renderBlock:      (node: NodeData, nodeId: string, updateProps: (patch: Record<string, unknown>) => void, map: NodeMap) => React.ReactNode
  defs:             ContentBlockDef[]
  defaultBlockProps: Record<string, Record<string, unknown>>
  disabled?:        boolean
}

export function ListBlock({ node, nodeId, nodeMap, onChange, disabled }: Props) {
  const style    = (node.props.style as 'bullet' | 'numbered') ?? 'bullet'
  const itemIds  = node.nodes
  const initRef  = useRef(false)

  // Legacy migration: if list has no child nodes but has `items` prop, migrate
  if (!initRef.current && itemIds.length === 0) {
    initRef.current = true
    const legacyItems = Array.isArray(node.props.items) ? (node.props.items as string[]) : ['']
    let map = nodeMap
    for (const text of legacyItems) {
      const result = addNode(map, 'list-item', { text }, nodeId)
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
    const { map } = addNode(nodeMap, 'list-item', { text: '' }, nodeId, afterIndex + 1)
    onChange(map)
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

  function indentItem(itemId: string, itemIndex: number) {
    // Indent = make this item a child of a sublist under the previous sibling
    if (itemIndex === 0) return
    const prevId = itemIds[itemIndex - 1]!
    const prevItem = nodeMap[prevId]!

    // Check if prev sibling already has a sublist
    const existingSublist = prevItem.nodes.find(id => nodeMap[id]?.type === 'list')
    let map = { ...nodeMap }

    if (existingSublist) {
      // Add to existing sublist
      const sublist = map[existingSublist]!
      map[existingSublist] = { ...sublist, nodes: [...sublist.nodes, itemId] }
    } else {
      // Create a new sublist under prev sibling
      const result = addNode(map, 'list', { style }, prevId)
      map = result.map
      // Move item into the new sublist
      const sublistId = result.id
      map[sublistId] = { ...map[sublistId]!, nodes: [itemId] }
    }

    // Remove item from current parent
    const parentNode = map[nodeId]!
    map[nodeId] = { ...parentNode, nodes: parentNode.nodes.filter(id => id !== itemId) }
    // Update item's parent
    const sublistId = existingSublist ?? Object.keys(map).find(k => map[k]!.nodes.includes(itemId) && k !== nodeId)!
    map[itemId] = { ...map[itemId]!, parent: sublistId }
    onChange(map)
  }

  function outdentItem(itemId: string) {
    // Outdent = move this item from sublist back to grandparent list
    // Current parent is this list (nodeId). This list's parent should be a list-item. That list-item's parent should be the grandparent list.
    const thisList = nodeMap[nodeId]
    if (!thisList) return
    const parentItem = nodeMap[thisList.parent]
    if (!parentItem) return
    const grandparentList = nodeMap[parentItem.parent]
    if (!grandparentList || grandparentList.type !== 'list') return

    let map = { ...nodeMap }

    // Remove item from this sublist
    const sublistNode = map[nodeId]!
    map[nodeId] = { ...sublistNode, nodes: sublistNode.nodes.filter(id => id !== itemId) }

    // Insert item after the parent list-item in the grandparent list
    const gpNode = map[parentItem.parent]!
    const parentItemIndex = gpNode.nodes.indexOf(thisList.parent)
    const newNodes = [...gpNode.nodes]
    newNodes.splice(parentItemIndex + 1, 0, itemId)
    map[parentItem.parent] = { ...gpNode, nodes: newNodes }

    // Update item's parent
    map[itemId] = { ...map[itemId]!, parent: parentItem.parent }

    // Clean up empty sublist
    if (map[nodeId]!.nodes.length === 0) {
      // Remove empty sublist from parent item
      const pItem = map[thisList.parent]!
      map[thisList.parent] = { ...pItem, nodes: pItem.nodes.filter(id => id !== nodeId) }
      delete map[nodeId]
    }

    onChange(map)
  }

  function handleKeyDown(itemId: string, itemIndex: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addItemAfter(itemIndex)
      setTimeout(() => {
        const container = (e.target as HTMLElement).closest('[data-list-id]')
        const inputs = container?.querySelectorAll(':scope > ul > li > input[data-list-item], :scope > ol > li > input[data-list-item]')
        const next = inputs?.[itemIndex + 1] as HTMLInputElement | undefined
        next?.focus()
      }, 0)
    }
    if (e.key === 'Backspace' && (e.target as HTMLInputElement).value === '' && itemIds.length > 1) {
      e.preventDefault()
      removeItem(itemId)
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      indentItem(itemId, itemIndex)
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      outdentItem(itemId)
    }
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
        {itemIds.map((itemId, i) => {
          const item = nodeMap[itemId]
          if (!item || item.type !== 'list-item') return null
          const sublistId = item.nodes.find(id => nodeMap[id]?.type === 'list')
          return (
            <li key={itemId}>
              <input
                type="text"
                data-list-item
                value={(item.props.text as string) ?? ''}
                onChange={(e) => updateItemText(itemId, e.target.value)}
                onKeyDown={(e) => handleKeyDown(itemId, i, e)}
                className="w-full bg-transparent outline-none text-sm py-0.5"
                placeholder="List item..."
                disabled={disabled}
              />
              {/* Render nested sublist if exists */}
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
                />
              )}
            </li>
          )
        })}
      </Tag>
    </div>
  )
}
