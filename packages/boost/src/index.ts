import { ServiceProvider, type Application } from '@rudderjs/core'

export { createBoostServer, startBoostMcp } from './server.js'
export { getAppInfo } from './tools/app-info.js'
export { getDbSchema } from './tools/db-schema.js'
export { getConfigValue } from './tools/config-get.js'
export { getRouteList } from './tools/route-list.js'
export { getModelList } from './tools/model-list.js'
export { getLastError } from './tools/last-error.js'
export { executeDbQuery } from './tools/db-query.js'
export { readLogs } from './tools/read-logs.js'
export { readBrowserLogs } from './tools/browser-logs.js'
export { getAbsoluteUrl } from './tools/get-absolute-url.js'

/**
 * Boost service provider — registers the `boost:mcp` rudder command.
 *
 * Usage in bootstrap/providers.ts:
 *   import { boost } from '@rudderjs/boost'
 *   export default [..., boost()]
 */
export function boost(): new (app: Application) => ServiceProvider {
  class BoostServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      try {
        const { rudder } = await import('@rudderjs/core')
        const { startBoostMcp } = await import('./server.js')

        rudder.command('boost:mcp', async () => {
          await startBoostMcp(process.cwd())
        }).description('Start the Boost MCP server (stdio transport)')
      } catch {
        // rudder not available
      }
    }
  }

  return BoostServiceProvider
}
