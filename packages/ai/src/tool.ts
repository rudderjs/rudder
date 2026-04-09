import type { z } from 'zod'
import { zodToJsonSchema } from './zod-to-json-schema.js'
import type {
  Tool,
  ToolDefinitionOptions,
  ToolDefinitionSchema,
  ToolExecuteFn,
} from './types.js'

/**
 * Builder returned by {@link toolDefinition}. The builder itself is a valid
 * `Tool` — call `.server(execute)` to attach a server-side handler, or use
 * the builder as-is to register a client tool (no `execute`).
 */
export class ToolBuilder<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> implements Tool<z.infer<TInput>, never> {
  readonly options: ToolDefinitionOptions<TInput, TOutput>
  readonly definition: ToolDefinitionOptions

  /** Builders are valid client tools — `execute` is intentionally absent. */
  readonly execute?: undefined

  constructor(options: ToolDefinitionOptions<TInput, TOutput>) {
    this.options = options
    this.definition = options as unknown as ToolDefinitionOptions
  }

  /**
   * Attach a server-side handler.
   *
   * The handler may be a regular async function (single return value) or an
   * async generator (`async function*`). Generators can `yield` preliminary
   * progress payloads — each yield surfaces as a `tool-update` stream chunk
   * while the tool runs. The generator's `return` value becomes the final
   * tool result. The same tool definition works in both `agent.prompt()`
   * (yields are silently drained) and `agent.stream()`.
   */
  server<TReturn = unknown>(
    execute: (input: z.infer<TInput>) => TReturn | Promise<TReturn>,
  ): Tool<z.infer<TInput>, TReturn>
  server<TReturn = unknown, TUpdate = unknown>(
    execute: (input: z.infer<TInput>) => AsyncGenerator<TUpdate, TReturn, void>,
  ): Tool<z.infer<TInput>, TReturn>
  server<TReturn = unknown>(
    execute: ToolExecuteFn<z.infer<TInput>, TReturn, unknown>,
  ): Tool<z.infer<TInput>, TReturn> {
    return { definition: this.options as unknown as ToolDefinitionOptions, execute }
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
 * @example  Server tool
 * const weatherTool = toolDefinition({
 *   name: 'get_weather',
 *   description: 'Get weather for a location',
 *   inputSchema: z.object({ location: z.string() }),
 * }).server(async ({ location }) => ({ temp: 72, unit: 'F' }))
 *
 * @example  Client tool (no `.server()`)
 * const readFormStateTool = toolDefinition({
 *   name: 'read_form_state',
 *   description: 'Read the user\'s current local form values.',
 *   inputSchema: z.object({ fields: z.array(z.string()).optional() }),
 * })
 */
export function toolDefinition<
  TInput extends z.ZodType,
  TOutput extends z.ZodType = z.ZodUndefined,
>(options: ToolDefinitionOptions<TInput, TOutput>): ToolBuilder<TInput, TOutput> {
  return new ToolBuilder(options)
}

/**
 * Build a tool whose input/output types are not known at compile time.
 *
 * Use this when the tool's schema is constructed dynamically from user data
 * (e.g. a resource agent that exposes one tool per agent definition).
 *
 * @example
 * const t = dynamicTool({
 *   name: agentDef.slug,
 *   description: agentDef.description,
 *   inputSchema: z.object({}),
 * }).server(async () => agentDef.run())
 */
export function dynamicTool(
  options: ToolDefinitionOptions,
): ToolBuilder {
  return new ToolBuilder(options as ToolDefinitionOptions<z.ZodType, z.ZodType>)
}

/** Convert any Tool to a ToolDefinitionSchema for provider consumption */
export function toolToSchema(tool: { definition: ToolDefinitionOptions }): ToolDefinitionSchema {
  return {
    name: tool.definition.name,
    description: tool.definition.description,
    parameters: zodToJsonSchema(tool.definition.inputSchema),
  }
}
