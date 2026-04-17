import type { z } from 'zod'
import { toKebabCase } from './utils.js'
import { getDescription } from './decorators.js'

export interface McpPromptMessage {
  role: 'user' | 'assistant'
  content: string
}

export abstract class McpPrompt {
  /** Prompt name */
  name(): string {
    return toKebabCase(this.constructor.name.replace(/Prompt$/, ''))
  }

  /** Description */
  description(): string {
    return getDescription(this.constructor) ?? ''
  }

  /** Arguments schema */
  arguments?(): z.ZodObject<z.ZodRawShape>

  /**
   * Generate prompt messages. Extra parameters beyond `args` are resolved
   * from the DI container when the method is decorated with `@Handle()`.
   */
  abstract handle(args: Record<string, unknown>, ...deps: unknown[]): Promise<McpPromptMessage[]>
}
