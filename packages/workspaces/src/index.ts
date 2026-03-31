// @boostkit/workspaces — AI workspace builder

// Plugin
export { workspaces, type WorkspacesConfig } from './plugin.js'

// Resources
export { WorkspaceResource } from './resources/WorkspaceResource.js'

// Canvas schema element + field
export { Canvas, type CanvasElementMeta } from './canvas/Canvas.js'
export { CanvasField } from './canvas/CanvasField.js'

// Node types
export type {
  CanvasNodeType,
  CanvasNodeBase,
  CanvasNode,
  RootNode,
  DepartmentNode,
  DepartmentProps,
  AgentNode,
  AgentProps,
  KnowledgeBaseNode,
  KnowledgeBaseProps,
  DocumentNode,
  DocumentProps,
  ConnectionNode,
  ConnectionProps,
} from './canvas/CanvasNode.js'
export { createRootNode, generateNodeId } from './canvas/CanvasNode.js'

// Fractional indexing
export { generateIndex, generateNIndices } from './canvas/fractional-index.js'

// Hooks (React)
export { useCanvasStore, type CanvasStoreOptions, type CanvasStoreReturn } from './canvas/useCanvasStore.js'
export { useCanvasViewport, type CanvasViewport, type UseCanvasViewportOptions, type UseCanvasViewportReturn } from './canvas/useCanvasViewport.js'
