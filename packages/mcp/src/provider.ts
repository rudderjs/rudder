import type { Application } from '@rudderjs/core'
import { ServiceProvider } from '@rudderjs/core'
import { Mcp } from './Mcp.js'

export function mcp(): new (app: Application) => ServiceProvider {
  class McpServiceProvider extends ServiceProvider {
    register(): void {
      this.app.instance('mcp', Mcp)
    }

    async boot(): Promise<void> {
      // Mount web MCP servers on the router
      const webServers = Mcp.getWebServers()
      if (webServers.size > 0) {
        try {
          const { mountHttpTransport } = await import('./runtime.js')
          for (const [path, entry] of webServers) {
            const server = new entry.server()
            await mountHttpTransport(server, path, {
              middleware: entry.middleware,
            })
          }
        } catch {
          // router or transport not available — skip web mounting
        }
      }

      // Register CLI commands
      try {
        const { rudder } = await import('@rudderjs/core')

        // mcp:start <name> — start a local server via stdio
        rudder.command('mcp:start', async (args: string[]) => {
          const name = args[0]
          const ServerClass = name != null ? Mcp.getLocalServers().get(name) : undefined
          if (!ServerClass) {
            console.error(`MCP server "${name}" not found. Available: ${[...Mcp.getLocalServers().keys()].join(', ')}`)
            process.exit(1)
          }
          const { startStdio } = await import('./runtime.js')
          await startStdio(new ServerClass())
        }).description('Start an MCP server (stdio)')

        // mcp:list — list all registered servers
        rudder.command('mcp:list', () => {
          const web = [...Mcp.getWebServers().entries()]
          const local = [...Mcp.getLocalServers().entries()]

          if (web.length === 0 && local.length === 0) {
            console.log('No MCP servers registered.')
            return
          }

          if (web.length > 0) {
            console.log('\nWeb Servers:')
            for (const [path, { server }] of web) {
              console.log(`  ${path} -> ${server.name}`)
            }
          }

          if (local.length > 0) {
            console.log('\nLocal Servers:')
            for (const [serverName, server] of local) {
              console.log(`  ${serverName} -> ${server.name}`)
            }
          }
        }).description('List registered MCP servers')
      } catch {
        // rudder not available
      }
    }
  }
  return McpServiceProvider
}
