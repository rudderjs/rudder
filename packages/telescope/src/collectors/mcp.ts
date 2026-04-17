import type { Collector, TelescopeStorage, TelescopeConfig } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

/**
 * Records MCP tool calls, resource reads, and prompt renders by subscribing
 * to `@rudderjs/mcp`'s observer registry.
 */
export class McpCollector implements Collector {
  readonly name = 'MCP Collector'
  readonly type = 'mcp' as const

  constructor(
    private readonly storage: TelescopeStorage,
    private readonly config:  TelescopeConfig,
  ) {}

  async register(): Promise<void> {
    try {
      const mod = await import('@rudderjs/mcp/observers') as unknown as {
        mcpObservers: { subscribe(fn: (event: McpEvent) => void): () => void }
      }
      const { mcpObservers } = mod

      const storage   = this.storage
      const threshold = this.config.slowMcpThreshold ?? 1000

      mcpObservers.subscribe((event: McpEvent) => {
        const subject = event.kind.split('.')[0] as 'tool' | 'resource' | 'prompt'
        const tags: string[] = [
          `server:${event.serverName}`,
          `type:${subject}`,
          `name:${event.name}`,
        ]
        if (event.kind.endsWith('.failed')) tags.push('error')
        if (event.duration > threshold)     tags.push('slow')

        storage.store(createEntry('mcp', {
          kind:       event.kind,
          serverName: event.serverName,
          name:       event.name,
          input:      event.input,
          output:     event.output,
          duration:   event.duration,
          error:      event.error,
        }, { tags, ...batchOpts() }))
      })
    } catch {
      // @rudderjs/mcp not installed — skip
    }
  }
}

// ─── Local event shape (mirrors @rudderjs/mcp/observers — no runtime import) ──

interface McpEvent {
  kind:
    | 'tool.called' | 'tool.failed'
    | 'resource.read' | 'resource.failed'
    | 'prompt.rendered' | 'prompt.failed'
  serverName: string
  name:       string
  input:      unknown
  output:     unknown
  duration:   number
  error?:     string
}
