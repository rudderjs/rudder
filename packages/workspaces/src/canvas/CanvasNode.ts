// ─── Node Types ───────────────────────────────────────────

export type CanvasNodeType =
  | 'root'
  | 'department'
  | 'agent'
  | 'knowledgeBase'
  | 'document'
  | 'connection'

// ─── Base Node ────────────────────────────────────────────

export interface CanvasNodeBase<TProps extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  type: CanvasNodeType
  parentId: string           // parent node ID ('root' for top-level)
  index: string              // fractional index for sibling ordering

  // Position
  x: number
  y: number
  z: number                  // elevation / layer

  // Visual
  width: number
  height: number

  // Type-specific props
  props: TProps

  // Collaboration metadata
  version: number
  updatedBy: string
  updatedAt: number          // epoch ms

  // Soft delete
  isDeleted?: boolean | undefined
}

// ─── Typed Props ──────────────────────────────────────────

export type DepartmentProps = {
  name: string
  color: string              // hex
  instructions?: string | undefined
}

export type AgentProps = {
  name: string
  role?: string | undefined
  systemPrompt: string
  model: string              // provider/model string
  temperature?: number | undefined
  maxTokens?: number | undefined
  tools?: string[] | undefined
  failover?: string[] | undefined
  active: boolean
}

export type KnowledgeBaseProps = {
  name: string
  description?: string | undefined
}

export type DocumentProps = {
  title: string
  type: 'text' | 'file' | 'url'
  content?: string | undefined
  mime?: string | undefined
  size?: number | undefined
}

export type HandlePosition = 'top' | 'bottom' | 'left' | 'right'

export type ConnectionRouting = 'L' | 'straight'

export type ConnectionProps = {
  fromId: string
  fromHandle?: HandlePosition | undefined
  toId: string
  toHandle?: HandlePosition | undefined
  label?: string | undefined
  style?: 'solid' | 'dashed' | 'dotted' | undefined
  routing?: ConnectionRouting | undefined
}

// ─── Typed Nodes ──────────────────────────────────────────

export interface DepartmentNode extends CanvasNodeBase<DepartmentProps> {
  type: 'department'
}

export interface AgentNode extends CanvasNodeBase<AgentProps> {
  type: 'agent'
}

export interface KnowledgeBaseNode extends CanvasNodeBase<KnowledgeBaseProps> {
  type: 'knowledgeBase'
}

export interface DocumentNode extends CanvasNodeBase<DocumentProps> {
  type: 'document'
}

export interface ConnectionNode extends CanvasNodeBase<ConnectionProps> {
  type: 'connection'
}

export interface RootNode extends CanvasNodeBase<Record<string, never>> {
  type: 'root'
}

export type CanvasNode =
  | RootNode
  | DepartmentNode
  | AgentNode
  | KnowledgeBaseNode
  | DocumentNode
  | ConnectionNode

// ─── Helpers ──────────────────────────────────────────────

/** Create the root node for a new workspace */
export function createRootNode(): RootNode {
  return {
    id: 'root',
    type: 'root',
    parentId: '',
    index: 'a0',
    x: 0,
    y: 0,
    z: 0,
    width: 0,
    height: 0,
    props: {} as Record<string, never>,
    version: 1,
    updatedBy: '',
    updatedAt: Date.now(),
  }
}

/** Generate a random node ID */
export function generateNodeId(): string {
  return `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// ─── Handle Positions ────────────────────────────────────

const AGENT_HALF = 6    // agent box size=12, half=6
const KB_HALF = 8       // KB cylinder radius=8

/** Get world position of a handle on a node */
export function getHandleWorldPos(
  node: CanvasNode,
  handle: HandlePosition,
  overrideX?: number,
  overrideZ?: number,
): { x: number; z: number } {
  const nx = overrideX ?? node.x
  const nz = overrideZ ?? node.y  // node.y = z in world space

  let hw: number, hh: number
  if (node.type === 'department') {
    hw = (node.width || 200) / 2
    hh = (node.height || 150) / 2
  } else if (node.type === 'agent') {
    hw = AGENT_HALF
    hh = AGENT_HALF
  } else if (node.type === 'knowledgeBase') {
    hw = KB_HALF
    hh = KB_HALF
  } else {
    hw = 6; hh = 6
  }

  switch (handle) {
    case 'top':    return { x: nx, z: nz - hh }
    case 'bottom': return { x: nx, z: nz + hh }
    case 'left':   return { x: nx - hw, z: nz }
    case 'right':  return { x: nx + hw, z: nz }
  }
}

/** Get all 4 handle positions for a node */
export function getAllHandles(
  node: CanvasNode,
  overrideX?: number,
  overrideZ?: number,
): Record<HandlePosition, { x: number; z: number }> {
  return {
    top: getHandleWorldPos(node, 'top', overrideX, overrideZ),
    bottom: getHandleWorldPos(node, 'bottom', overrideX, overrideZ),
    left: getHandleWorldPos(node, 'left', overrideX, overrideZ),
    right: getHandleWorldPos(node, 'right', overrideX, overrideZ),
  }
}

/** Find the closest handle to a world point */
export function findClosestHandle(
  node: CanvasNode,
  hitX: number,
  hitZ: number,
): HandlePosition {
  const handles = getAllHandles(node)
  let best: HandlePosition = 'right'
  let bestDist = Infinity
  for (const [name, pos] of Object.entries(handles) as [HandlePosition, { x: number; z: number }][]) {
    const d = Math.abs(hitX - pos.x) + Math.abs(hitZ - pos.z)
    if (d < bestDist) { best = name; bestDist = d }
  }
  return best
}
