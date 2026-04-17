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

  /** Optional output schema using Zod — advertises the structure of the tool's response */
  outputSchema?(): z.ZodObject<z.ZodRawShape>

  /**
   * Handle the tool call.
   *
   * Extra parameters beyond `input` are resolved from the DI container when
   * the method is decorated with `@Handle()` (required for TypeScript to
   * emit parameter-type metadata). Example:
   *
   * ```ts
   * @Handle()
   * async handle(input, logger: Logger) { ... }
   * ```
   */
  abstract handle(input: Record<string, unknown>, ...deps: unknown[]): Promise<McpToolResult>
}
