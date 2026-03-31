// @boostkit/workspaces — AI workspace builder

// Plugin
export { workspaces, type WorkspacesConfig } from './plugin.js'

// Models
export { Workspace } from './models/Workspace.js'

// Resources
export { WorkspaceResource } from './resources/WorkspaceResource.js'

// Canvas schema element + field
export { Canvas, type CanvasElementMeta } from './canvas/Canvas.js'
export { CanvasField } from './canvas/CanvasField.js'

// Chat schema element + field
export { Chat, type ChatElementMeta } from './chat/Chat.js'
export { ChatField } from './chat/ChatField.js'

// Orchestrator
export { Orchestrator, type OrchestratorOptions, type OrchestratorResponse, type OrchestratorStreamResponse } from './orchestrator/Orchestrator.js'
export { buildDepartmentAgent } from './orchestrator/buildDepartmentAgent.js'
export { createDepartmentTool } from './orchestrator/DepartmentTool.js'
export { broadcastMiddleware } from './orchestrator/OrchestratorMiddleware.js'

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

// React Components (client-only — use with ClientOnly wrapper or dynamic import)
export { WorkspaceCanvas } from './components/canvas/WorkspaceCanvas.js'
export { ChatPanel } from './components/chat/ChatPanel.js'
export { ChatMessage } from './components/chat/ChatMessage.js'
export { ChatInput } from './components/chat/ChatInput.js'
export { StreamingMessage } from './components/chat/StreamingMessage.js'
