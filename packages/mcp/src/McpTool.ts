import type { z } from 'zod'
import { toKebabCase } from './utils.js'
import { getDescription } from './decorators.js'

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  isError?: boolean
}

export abstract class McpTool {
  /** Tool name — derived from class name if not overridden. ClassName -> kebab-case minus "Tool" suffix */
  name(): string {
    return toKebabCase(this.constructor.name.replace(/Tool$/, ''))
  }

  /** Tool description — override or use @Description decorator */
  description(): string {
    return getDescription(this.constructor) ?? ''
  }

  /** Input schema using Zod */
  abstract schema(): z.ZodObject<z.ZodRawShape>

  /** Handle the tool call */
  abstract handle(input: Record<string, unknown>): Promise<McpToolResult>
}
