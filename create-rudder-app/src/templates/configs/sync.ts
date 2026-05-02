import type { TemplateContext } from '../../templates.js'

export function configSync(ctx: TemplateContext): string {
  const persistenceImport = ctx.orm === 'prisma' ? "\nimport { syncPrisma } from '@rudderjs/sync'" : ''
  const persistenceLine   = ctx.orm === 'prisma'
    ? '\n  // Server-side persistence — Y.Docs survive server restarts\n  persistence: syncPrisma(),\n'
    : ''
  return `import { Env } from '@rudderjs/support'${persistenceImport}
import type { SyncConfig } from '@rudderjs/sync'

export default {
  path: Env.get('SYNC_PATH', '/ws-sync'),
${persistenceLine}
  // Client-side providers
  providers: ['websocket', 'indexeddb'],
} satisfies SyncConfig
`
}

