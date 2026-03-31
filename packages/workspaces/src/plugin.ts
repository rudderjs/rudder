import type { MiddlewareHandler } from '@boostkit/core'
import type { PanelPlugin } from '@boostkit/panels'
import { WorkspaceResource } from './resources/WorkspaceResource.js'

const schemaDir = new URL(/* @vite-ignore */ '../schema', import.meta.url).pathname

// ─── Config ──────────────────────────────────────────────

export interface WorkspacesConfig {
  /** Default AI model for new agents (e.g. 'anthropic/claude-sonnet-4-5') */
  defaultModel?: string | undefined
}

// ─── Plugin Factory ──────────────────────────────────────

/**
 * Workspaces panel plugin — collaborative AI workspace canvas + orchestrator chat.
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
    register(panel) {
      const existing = panel.getResources()
      panel.resources([
        ...existing,
        WorkspaceResource,
      ])
    },

    async boot(panel) {
      // Mount chat API routes
      try {
        type AppReq = import('@boostkit/core').AppRequest
        type AppRes = import('@boostkit/core').AppResponse
        interface RouterShape {
          post(path: string, handler: (req: AppReq, res: AppRes) => unknown, mw?: MiddlewareHandler[]): void
          get(path: string, handler: (req: AppReq, res: AppRes) => unknown, mw?: MiddlewareHandler[]): void
        }
        const { router } = await import(/* @vite-ignore */ '@boostkit/router') as { router: RouterShape }
        const { mountChatRoutes } = await import('./chat/chatRoutes.js')

        const mw: MiddlewareHandler[] = []
        const guard = panel.getGuard()
        if (guard) mw.push(guard as unknown as MiddlewareHandler)

        // Prisma getter — lazily resolve from DI or global
        const getPrisma = async () => {
          try {
            const { app } = await import(/* @vite-ignore */ '@boostkit/core')
            return app().make('prisma')
          } catch {
            return null
          }
        }

        mountChatRoutes(router, panel.getApiBase(), mw, getPrisma)
      } catch {
        // Router not installed — chat routes not mounted
      }
    },
  }
}
