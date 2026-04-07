import type { McpTool } from './McpTool.js'
import type { McpResource } from './McpResource.js'
import type { McpPrompt } from './McpPrompt.js'
import { getServerMetadata } from './decorators.js'

export interface McpServerMetadata {
  name?: string
  version?: string
  instructions?: string
}

export abstract class McpServer {
  /** Tool classes to register */
  protected tools: (new () => McpTool)[] = []

  /** Resource classes to register */
  protected resources: (new () => McpResource)[] = []

  /** Prompt classes to register */
  protected prompts: (new () => McpPrompt)[] = []

  /** Server metadata — override or use decorators */
  metadata(): Required<Pick<McpServerMetadata, 'name' | 'version'>> & Pick<McpServerMetadata, 'instructions'> {
    const meta = getServerMetadata(this.constructor)
    return {
      name: meta.name ?? this.constructor.name,
      version: meta.version ?? '1.0.0',
      ...(meta.instructions != null ? { instructions: meta.instructions } : {}),
    }
  }
}
