import { toKebabCase } from './utils.js'
import { getDescription } from './decorators.js'
import type { ZodLikeObject } from './types.js'

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

  /** Input schema — a Zod object (v3 or v4). */
  abstract schema(): ZodLikeObject

  /** Optional output schema — advertises the structure of the tool's response. */
  outputSchema?(): ZodLikeObject

  /**
   * Handle the tool call.
   *
   * Extra parameters beyond `input` are resolved from the DI container when
   * the method is decorated with `@Handle(Token1, …)`. Example:
   *
   * ```ts
   * @Handle(Logger)
   * async handle(input, logger: Logger) { ... }
   * ```
   */
  abstract handle(input: Record<string, unknown>, ...deps: unknown[]): Promise<McpToolResult>
}
