import { useEffect, useRef } from 'react'
import type { NodeData, NodeMap, ContentBlockDef } from '@boostkit/panels'
import { addNode, removeNodeRecursive } from '@boostkit/panels'
import { NestedBlockEditor } from './NestedBlockEditor.js'

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

export function TableBlock({ node, nodeId, nodeMap, onChange, renderBlock, defs, defaultBlockProps, disabled }: Props) {
  const rows = (node.props.rows as number) ?? 2
  const cols = (node.props.cols as number) ?? 2
  const totalCells = rows * cols
  const cellIds = node.nodes
  const initRef = useRef(false)

  // Initialize cell nodes if table was just created (empty nodes[])
  useEffect(() => {
    if (initRef.current) return
    if (cellIds.length >= totalCells) { initRef.current = true; return }
    initRef.current = true

    let map = nodeMap
    const cellsToAdd = totalCells - cellIds.length
    for (let i = 0; i < cellsToAdd; i++) {
      const result = addNode(map, 'table-cell', {}, nodeId)
      map = result.map
    }
    onChange(map)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Don't render until cells are initialized
  if (cellIds.length < totalCells) return null

  function addRow() {
    let map = { ...nodeMap }
    for (let c = 0; c < cols; c++) {
      const result = addNode(map, 'table-cell', {}, nodeId)
      map = result.map
    }
    // Update rows prop
    const tableNode = map[nodeId]!
    map = { ...map, [nodeId]: { ...tableNode, props: { ...tableNode.props, rows: rows + 1 } } }
    onChange(map)
  }

  function removeRow() {
    if (rows <= 1) return
    let map = nodeMap
    const tableNode = map[nodeId]!
    const cellsToRemove = tableNode.nodes.slice(-cols)
    for (const cellId of cellsToRemove) {
      map = removeNodeRecursive(map, cellId)
    }
    // Update rows prop
    const updated = map[nodeId]!
    map = { ...map, [nodeId]: { ...updated, props: { ...updated.props, rows: rows - 1 } } }
    onChange(map)
  }

  function addCol() {
    let map = nodeMap
    // Insert a new cell at the end of each row (go top to bottom)
    for (let r = 0; r < rows; r++) {
      const insertAt = (r + 1) * cols + r // adjusted for previously inserted cells
      const result = addNode(map, 'table-cell', {}, nodeId, insertAt)
      map = result.map
    }
    // Update cols prop
    const updated = map[nodeId]!
    map = { ...map, [nodeId]: { ...updated, props: { ...updated.props, cols: cols + 1 } } }
    onChange(map)
  }

  function removeCol() {
    if (cols <= 1) return
    let map = nodeMap
    const tableNode = map[nodeId]!

    // Remove last column cells (go bottom to top to preserve indices)
    for (let r = rows - 1; r >= 0; r--) {
      const cellIdx = r * cols + (cols - 1)
      const cellId = tableNode.nodes[cellIdx]
      if (cellId) {
        map = removeNodeRecursive(map, cellId)
      }
    }
    // Update cols prop
    const updated = map[nodeId]!
    map = { ...map, [nodeId]: { ...updated, props: { ...updated.props, cols: cols - 1 } } }
    onChange(map)
  }

  // Filter defs: don't allow inserting tables inside table cells (prevent infinite nesting)
  const cellDefs = defs.filter(d => d.type !== 'table')

  return (
    <div className="my-2">
      {/* Table controls */}
      {!disabled && (
        <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
          <span>{rows} &times; {cols}</span>
          <button type="button" onClick={addRow} className="hover:text-foreground transition-colors">+ Row</button>
          <button type="button" onClick={removeRow} className="hover:text-foreground transition-colors" disabled={rows <= 1}>- Row</button>
          <button type="button" onClick={addCol} className="hover:text-foreground transition-colors">+ Col</button>
          <button type="button" onClick={removeCol} className="hover:text-foreground transition-colors" disabled={cols <= 1}>- Col</button>
        </div>
      )}

      {/* Table grid */}
      <table className="w-full border-collapse border border-border text-sm">
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => {
                const cellId = cellIds[r * cols + c]
                if (!cellId) return <td key={c} className="border border-border p-2" />
                return (
                  <td key={cellId} className="border border-border p-2 align-top min-w-[120px]">
                    <NestedBlockEditor
                      nodeMap={nodeMap}
                      parentId={cellId}
                      onChange={onChange}
                      renderBlock={renderBlock}
                      defs={cellDefs}
                      defaultBlockProps={defaultBlockProps}
                      disabled={disabled}
                      placeholder="Type or add block..."
                      autoEmptyParagraph
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
