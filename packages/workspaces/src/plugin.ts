import type { PanelPlugin } from '@boostkit/panels'
import { WorkspaceResource } from './resources/WorkspaceResource.js'
import { DepartmentResource } from './resources/DepartmentResource.js'
import { AgentResource } from './resources/AgentResource.js'
import { KnowledgeBaseResource } from './resources/KnowledgeBaseResource.js'
import { DocumentResource } from './resources/DocumentResource.js'

const schemaDir = new URL(/* @vite-ignore */ '../schema', import.meta.url).pathname

// ─── Config ──────────────────────────────────────────────

export interface WorkspacesConfig {
  /** Default AI model for new agents (e.g. 'anthropic/claude-sonnet-4-5') */
  defaultModel?: string | undefined
}

// ─── Plugin Factory ──────────────────────────────────────

/**
 * Workspaces panel plugin — departments, agents, knowledge base CRUD.
 *
 * @example
 * import { workspaces } from '@boostkit/workspaces'
 *
 * Panel.make('admin')
 *   .use(workspaces())
 *   .resources([...])
 */
export function workspaces(config?: WorkspacesConfig): PanelPlugin {
  return {
    schemas: [
      { from: `${schemaDir}/workspaces.prisma`, to: 'prisma/schema', tag: 'workspaces-schema', orm: 'prisma' as const },
    ],

    register(panel) {
      // Append workspace resources to the panel's existing resources
      const existing = panel.getResources()
      panel.resources([
        ...existing,
        WorkspaceResource,
        DepartmentResource,
        AgentResource,
        KnowledgeBaseResource,
        DocumentResource,
      ])
    },

    async boot(_panel) {
      // Phase 3: mount orchestrator/chat API routes here
    },
  }
}
