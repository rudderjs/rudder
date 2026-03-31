import type { PanelPlugin } from '@boostkit/panels'
import { WorkspaceResource } from './resources/WorkspaceResource.js'

const schemaDir = new URL(/* @vite-ignore */ '../schema', import.meta.url).pathname
const pagesDir  = new URL(/* @vite-ignore */ '../pages', import.meta.url).pathname

// ─── Config ──────────────────────────────────────────────

export interface WorkspacesConfig {
  /** Default AI model for new agents (e.g. 'anthropic/claude-sonnet-4-5') */
  defaultModel?: string | undefined
}

// ─── Plugin Factory ──────────────────────────────────────

/**
 * Workspaces panel plugin — collaborative AI workspace canvas.
 *
 * @example
 * import { workspaces } from '@boostkit/workspaces'
 *
 * Panel.make('admin')
 *   .use(workspaces())
 *   .resources([...])
 */
export function workspaces(_config?: WorkspacesConfig): PanelPlugin {
  return {
    schemas: [
      { from: `${schemaDir}/workspaces.prisma`, to: 'prisma/schema', tag: 'workspaces-schema', orm: 'prisma' as const },
    ],
    pages: pagesDir,

    register(panel) {
      const existing = panel.getResources()
      panel.resources([
        ...existing,
        WorkspaceResource,
      ])
    },

    async boot(_panel) {
      // Phase 3: mount orchestrator/chat API routes
    },
  }
}
