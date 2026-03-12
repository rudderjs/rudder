// ─── Types ───────────────────────────────────────────────────

/** A single node in a flat node tree. */
export interface NodeData {
  type:   string                    // block type name (e.g. 'hero', 'paragraph', 'image')
  props:  Record<string, unknown>   // type-specific data
  parent: string                    // parent node ID ('' for ROOT)
  nodes:  string[]                  // ordered child IDs (empty for leaf nodes)
}

/** Flat map of nodeId → NodeData. Always has a ROOT entry. */
export type NodeMap = Record<string, NodeData>

// ─── ID generation ───────────────────────────────────────────

/** Generate a short unique node ID. */
export function nodeId(): string {
  return Math.random().toString(36).slice(2, 8)
}

// ─── Factory ─────────────────────────────────────────────────

/** Create an empty NodeMap with just a ROOT container. */
export function emptyNodeMap(): NodeMap {
  return {
    ROOT: { type: 'container', props: {}, parent: '', nodes: [] },
  }
}

// ─── Pure helpers (return new NodeMap — never mutate) ─────────

/** Add a node at a given position in the parent's children. */
export function addNode(
  map: NodeMap,
  type: string,
  props: Record<string, unknown>,
  parentId: string = 'ROOT',
  atIndex?: number,
): { map: NodeMap; id: string } {
  const id     = nodeId()
  const parent = map[parentId]
  if (!parent) return { map, id }

  const newNodes = [...parent.nodes]
  const idx = atIndex ?? newNodes.length
  newNodes.splice(idx, 0, id)

  return {
    id,
    map: {
      ...map,
      [parentId]: { ...parent, nodes: newNodes },
      [id]:       { type, props, parent: parentId, nodes: [] },
    },
  }
}

/** Update a node's props (shallow merge). */
export function updateNodeProps(
  map: NodeMap,
  id: string,
  propsPatch: Record<string, unknown>,
): NodeMap {
  const node = map[id]
  if (!node) return map
  return { ...map, [id]: { ...node, props: { ...node.props, ...propsPatch } } }
}

/** Remove a node and its ID from its parent's nodes array. */
export function removeNode(map: NodeMap, id: string): NodeMap {
  const node = map[id]
  if (!node) return map
  const parent = map[node.parent]
  if (!parent) return map

  const { [id]: _removed, ...rest } = map
  return {
    ...rest,
    [node.parent]: { ...parent, nodes: parent.nodes.filter(nid => nid !== id) },
  }
}

/** Move a node up or down within its parent's nodes array. */
export function moveNode(map: NodeMap, id: string, direction: -1 | 1): NodeMap {
  const node = map[id]
  if (!node) return map
  const parent = map[node.parent]
  if (!parent) return map

  const nodes = [...parent.nodes]
  const idx   = nodes.indexOf(id)
  const other = idx + direction
  if (other < 0 || other >= nodes.length) return map
  ;[nodes[idx], nodes[other]] = [nodes[other]!, nodes[idx]!]

  return { ...map, [node.parent]: { ...parent, nodes } }
}

/** Reorder: move a node from one index to another (for dnd-kit). */
export function reorderNode(map: NodeMap, id: string, fromIndex: number, toIndex: number): NodeMap {
  const node = map[id]
  if (!node) return map
  const parent = map[node.parent]
  if (!parent) return map

  const nodes = [...parent.nodes]
  nodes.splice(fromIndex, 1)
  nodes.splice(toIndex, 0, id)

  return { ...map, [node.parent]: { ...parent, nodes } }
}

// ─── Migration: array → NodeMap ──────────────────────────────

/**
 * Convert a legacy array-of-blocks `[{ _type, ...fields }]` into a NodeMap.
 * Used for backward compatibility with existing Builder field data.
 */
export function arrayToNodeMap(
  blocks: Array<{ _type: string; [key: string]: unknown }>,
): NodeMap {
  const map: NodeMap = {
    ROOT: { type: 'container', props: {}, parent: '', nodes: [] },
  }
  for (const block of blocks) {
    const id = nodeId()
    const { _type, ...props } = block
    map.ROOT!.nodes.push(id)
    map[id] = { type: _type, props, parent: 'ROOT', nodes: [] }
  }
  return map
}

/**
 * Convert a legacy Repeater array `[{ ...fields }]` (no _type) into a NodeMap.
 * Each item becomes a node with type 'item'.
 */
export function repeaterArrayToNodeMap(
  items: Array<Record<string, unknown>>,
): NodeMap {
  const map: NodeMap = {
    ROOT: { type: 'container', props: {}, parent: '', nodes: [] },
  }
  for (const item of items) {
    const id = nodeId()
    map.ROOT!.nodes.push(id)
    map[id] = { type: 'item', props: { ...item }, parent: 'ROOT', nodes: [] }
  }
  return map
}

/**
 * Convert a NodeMap back to array format for reading.
 * Walks ROOT.nodes in order and flattens to [{ _type, ...props }].
 */
export function nodeMapToArray(
  map: NodeMap,
): Array<{ _type: string; [key: string]: unknown }> {
  const root = map.ROOT
  if (!root) return []
  return root.nodes
    .map(id => map[id])
    .filter(Boolean)
    .map(node => ({ _type: node!.type, ...node!.props }))
}

/**
 * Detect if a value is already a NodeMap or a legacy array.
 * Returns a normalized NodeMap either way.
 */
export function ensureNodeMap(value: unknown): NodeMap {
  if (!value) return emptyNodeMap()
  if (Array.isArray(value)) {
    // Detect Builder (has _type) vs Repeater (no _type)
    if (value.length > 0 && '_type' in value[0]) {
      return arrayToNodeMap(value as Array<{ _type: string; [key: string]: unknown }>)
    }
    return repeaterArrayToNodeMap(value as Array<Record<string, unknown>>)
  }
  if (typeof value === 'object' && 'ROOT' in (value as object)) return value as NodeMap
  return emptyNodeMap()
}
