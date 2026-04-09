import type { z } from 'zod'
import { zodToJsonSchema } from './zod-to-json-schema.js'
import type {
  Tool,
  ToolCall,
  ToolCallContext,
  ToolDefinitionOptions,
  ToolDefinitionSchema,
  ToolExecuteFn,
} from './types.js'

/**
 * Typed error a server tool can throw to pause the enclosing agent loop
 * and surface a set of CLIENT tool calls to the caller — as if the model
 * itself had emitted them.
 *
 * This is the one sanctioned way for a server tool to inject client-tool
 * calls into the parent loop's pending list. The agent loop's tool-execute
 * catch recognizes the error (via `instanceof PauseLoopForClientTools`),
 * appends `toolCalls` to the parent's `pendingClientToolCalls`, sets the
 * stop-for-client-tools flag, and — critically — does NOT push an error
 * tool result / tool message for the throwing tool call. The throwing
 * tool's own call remains orphaned in the parent's message history until
 * the caller resolves it on continuation (typically by computing a final
 * result from whatever the client-side tool execution returned).
 *
 * **Primary use case:** nested agent runners. A `run_agent`-style tool
 * that streams a sub-agent server-side can hit a pause point when the
 * sub-agent's model calls a client tool. Those client calls have to be
 * executed in the browser, not server-side, so the parent loop must
 * surface them to its own caller. Throwing this error is how.
 *
 * Tools that throw this error are responsible for persisting any state
 * they need to resume the inner work on continuation (usually in a cache
 * or runStore). `@rudderjs/ai` does not know or care about that state —
 * it just propagates the pause.
 */
export class PauseLoopForClientTools extends Error {
  readonly toolCalls: ToolCall[]

  constructor(toolCalls: ToolCall[], message?: string) {
    super(message ?? 'Agent loop paused for nested client tool calls')
    this.name = 'PauseLoopForClientTools'
    this.toolCalls = toolCalls
  }
}

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
  // The generator overload MUST come first. If the plain-async overload is
  // tried first, TypeScript happily binds `TReturn = AsyncGenerator<...>` for
  // an `async function*`, which then leaks the generator type into chained
  // refinements like `.modelOutput(result => ...)`. Generators have a
  // structural protocol (`.next` / `.return` / `[Symbol.asyncIterator]`) that
  // doesn't match `Promise<T>`, so non-generator executes still resolve
  // cleanly to the second overload.
  server<TReturn = unknown, TUpdate = unknown>(
    execute: (input: z.infer<TInput>, ctx?: ToolCallContext) => AsyncGenerator<TUpdate, TReturn, void>,
  ): ServerToolBuilder<z.infer<TInput>, TReturn>
  server<TReturn = unknown>(
    execute: (input: z.infer<TInput>, ctx?: ToolCallContext) => TReturn | Promise<TReturn>,
  ): ServerToolBuilder<z.infer<TInput>, TReturn>
  server<TReturn = unknown>(
    execute: ToolExecuteFn<z.infer<TInput>, TReturn, unknown>,
  ): ServerToolBuilder<z.infer<TInput>, TReturn> {
    return new ServerToolBuilder<z.infer<TInput>, TReturn>(
      this.options as unknown as ToolDefinitionOptions,
      execute as ToolExecuteFn<z.infer<TInput>, TReturn, unknown>,
    )
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
 * Builder returned by {@link ToolBuilder.server}. Itself a valid `Tool`, so
 * it can be passed directly into `tools()` arrays — `.toModelOutput(...)` is
 * an optional chained refinement, not a required `.build()` step.
 *
 * Future per-tool refinements (`.onError(...)`, `.middleware(...)`) would slot
 * in here in the same chained-builder style.
 */
export class ServerToolBuilder<TInput = unknown, TOutput = unknown>
  implements Tool<TInput, TOutput>
{
  readonly definition: ToolDefinitionOptions
  readonly execute: ToolExecuteFn<TInput, TOutput, unknown>
  readonly toModelOutput?: ((result: TOutput) => string | Promise<string>) | undefined

  constructor(
    definition: ToolDefinitionOptions,
    execute: ToolExecuteFn<TInput, TOutput, unknown>,
    toModelOutput?: (result: TOutput) => string | Promise<string>,
  ) {
    this.definition = definition
    this.execute = execute
    if (toModelOutput) this.toModelOutput = toModelOutput
  }

  /**
   * Declare a transform from this tool's structured result to the string the
   * **model** sees on its next step. The UI continues to receive the original
   * structured result.
   *
   * @example
   * toolDefinition({...})
   *   .server(async (input) => bigStructuredResult)
   *   .modelOutput((result) => `${result.items.length} items found`)
   */
  modelOutput(
    fn: (result: TOutput) => string | Promise<string>,
  ): ServerToolBuilder<TInput, TOutput> {
    return new ServerToolBuilder<TInput, TOutput>(this.definition, this.execute, fn)
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
