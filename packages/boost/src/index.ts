import { ServiceProvider } from '@rudderjs/core'

export { createBoostServer, startBoostMcp } from './server.js'
export { getAppInfo } from './tools/app-info.js'
export { getDbSchema } from './tools/db-schema.js'
export { getConfigValue } from './tools/config-get.js'
export { getRouteList } from './tools/route-list.js'
export { getModelList } from './tools/model-list.js'
export { getLastError } from './tools/last-error.js'
export { searchDocs } from './tools/search-docs.js'
export type { SearchResult } from './tools/search-docs.js'
export { boostInstall } from './commands/install.js'
export type { BoostInstallOptions } from './commands/install.js'
export { boostUpdate } from './commands/update.js'
export type { BoostAgent, SkillEntry } from './agents/types.js'
export { builtInAgents } from './agents/index.js'
export { Boost } from './Boost.js'

/**
 * Boost service provider — registers the `boost:mcp` rudder command.
 *
 * Usage in bootstrap/providers.ts:
 *   import { BoostProvider } from '@rudderjs/boost'
 *   export default [..., BoostProvider]
 */
export class BoostProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    try {
      const { rudder } = await import('@rudderjs/core')
      const { startBoostMcp } = await import('./server.js')

      rudder.command('boost:mcp', async () => {
        await startBoostMcp(process.cwd())
      }).description('Start the Boost MCP server (stdio transport)')

      rudder.command('boost:install', async (args: string[]) => {
        const { boostInstall } = await import('./commands/install.js')
        await boostInstall(process.cwd(), { args })
      }).description('Generate IDE configs for AI coding assistants (--agent=claude-code,cursor)')

      rudder.command('boost:update', async () => {
        const { boostUpdate } = await import('./commands/update.js')
        await boostUpdate(process.cwd())
      }).description('Update AI guidelines and skills from installed packages')
    } catch {
      // rudder not available
    }
  }
}
