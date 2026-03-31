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

export type ConnectionProps = {
  fromId: string
  toId: string
  label?: string | undefined
  style?: 'solid' | 'dashed' | 'dotted' | undefined
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
