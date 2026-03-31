import type { z } from 'zod'
import { zodToJsonSchema } from './zod-to-json-schema.js'
import type {
  ToolDefinitionOptions,
  ToolDefinitionSchema,
  ToolExecuteFn,
  ServerTool,
  ClientTool,
} from './types.js'

export class ToolBuilder<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  readonly options: ToolDefinitionOptions<TInput, TOutput>

  constructor(options: ToolDefinitionOptions<TInput, TOutput>) {
    this.options = options
  }

  /** Create a server-side tool */
  server<TReturn = unknown>(execute: ToolExecuteFn<z.infer<TInput>, TReturn>): ServerTool<z.infer<TInput>, TReturn> {
    return { definition: this.options as unknown as ToolDefinitionOptions, type: 'server', execute }
  }

  /** Create a client-side tool */
  client<TReturn = unknown>(execute: ToolExecuteFn<z.infer<TInput>, TReturn>): ClientTool<z.infer<TInput>, TReturn> {
    return { definition: this.options as unknown as ToolDefinitionOptions, type: 'client', execute }
  }

  /** Convert to provider-friendly JSON Schema format */
  toSchema(): ToolDefinitionSchema {
    return {
      name: this.options.name,
      description: this.options.description,
      parameters: zodToJsonSchema(this.options.inputSchema),
    }
  }
}

/**
 * Define a tool with typed input/output schemas.
 *
 * @example
 * const weatherTool = toolDefinition({
 *   name: 'get_weather',
 *   description: 'Get weather for a location',
 *   inputSchema: z.object({ location: z.string() }),
 * }).server(async ({ location }) => ({ temp: 72, unit: 'F' }))
 */
export function toolDefinition<
  TInput extends z.ZodType,
  TOutput extends z.ZodType = z.ZodUndefined,
>(options: ToolDefinitionOptions<TInput, TOutput>): ToolBuilder<TInput, TOutput> {
  return new ToolBuilder(options)
}

/** Convert any AnyTool to a ToolDefinitionSchema for provider consumption */
export function toolToSchema(tool: { definition: ToolDefinitionOptions }): ToolDefinitionSchema {
  return {
    name: tool.definition.name,
    description: tool.definition.description,
    parameters: zodToJsonSchema(tool.definition.inputSchema),
  }
}
