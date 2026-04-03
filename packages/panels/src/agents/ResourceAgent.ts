import type { ResourceAgentMeta } from './types.js'

// ─── Lazy imports (optional peer deps) ─────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

let _ai: { agent: any; toolDefinition: any; z: any } | undefined

async function loadAi() {
  if (!_ai) {
    const ai  = await import(/* @vite-ignore */ '@boostkit/ai') as any
    const zod = await import(/* @vite-ignore */ 'zod') as any
    _ai = { agent: ai.agent, toolDefinition: ai.toolDefinition, z: zod.z }
  }
  return _ai!
}

async function loadLive() {
  const mod = await import(/* @vite-ignore */ '@boostkit/live') as any
  return mod.Live as {
    updateMap(docName: string, mapName: string, field: string, value: unknown): Promise<void>
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Runtime context ────────────────────────────────────────

export interface ResourceAgentContext {
  record:       Record<string, unknown>
  resourceSlug: string
  recordId:     string
  panelSlug:    string
}

// ─── ResourceAgent ─────────────────────────────────────────

/**
 * AI agent that operates on a panel resource record.
 *
 * Use the fluent builder for simple inline agents:
 * ```ts
 * ResourceAgent.make('seo')
 *   .label('Improve SEO')
 *   .instructions('Analyse and improve SEO...')
 *   .fields(['title', 'slug', 'metaDescription'])
 * ```
 *
 * Or extend the class for complex agents with custom tools:
 * ```ts
 * class TranslateAgent extends ResourceAgent {
 *   constructor() {
 *     super('translate')
 *     this.label('Translate').icon('Languages')
 *     this.fields(['title', 'content'])
 *   }
 *   resolveInstructions() { return 'Translate all fields...' }
 *   extraTools() { return [lookupTermTool] }
 * }
 * ```
 */
export class ResourceAgent {
  protected _slug:  string
  protected _label: string
  protected _icon?: string
  protected _instructions: string | ((record: Record<string, unknown>) => string) = ''
  protected _fields: string[] = []
  protected _model?: string
  protected _tools: Array<{ definition: { name: string }; type: string; execute: Function }> = []

  /** Runtime context — set before run/stream. */
  protected context!: ResourceAgentContext

  constructor(slug: string) {
    this._slug  = slug
    this._label = slug
  }

  // ── Fluent builder ─────────────────────────────────────

  static make(slug: string): ResourceAgent {
    return new ResourceAgent(slug)
  }

  label(l: string): this  { this._label = l; return this }
  icon(i: string): this   { this._icon = i; return this }
  model(m: string): this  { this._model = m; return this }

  instructions(i: string | ((record: Record<string, unknown>) => string)): this {
    this._instructions = i
    return this
  }

  fields(f: string[]): this {
    this._fields = f
    return this
  }

  /** Add custom tools beyond the auto-generated field tools. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools(t: any[]): this {
    this._tools = t
    return this
  }

  // ── Override points for subclasses ─────────────────────

  /** Override for dynamic instructions based on record data. */
  resolveInstructions(): string {
    return typeof this._instructions === 'function'
      ? this._instructions(this.context.record)
      : this._instructions
  }

  /** Override to provide additional tools beyond field update tools. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraTools(): any[] {
    return []
  }

  /** Called before the agent runs. Throw to abort. */
  async beforeRun?(_ctx: ResourceAgentContext): Promise<void>

  /** Called after the agent completes. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async afterRun?(_ctx: ResourceAgentContext, _result: any): Promise<void>

  // ── Build tools ────────────────────────────────────────

  /** @internal — builds auto-generated field tools + custom tools. */
  protected async buildTools() {
    const { toolDefinition, z } = await loadAi()
    const Live = await loadLive()

    const allFields = this._fields

    const updateField = toolDefinition({
      name: 'update_field',
      description: 'Update a field on the current record. Available fields: ' + allFields.join(', '),
      inputSchema: z.object({
        field: z.enum(allFields as [string, ...string[]]),
        value: z.string().describe('The new value for the field'),
      }),
    }).server(async (input: { field: string; value: string }) => {
      const docName = `panel:${this.context.resourceSlug}:${this.context.recordId}`
      await Live.updateMap(docName, 'fields', input.field, input.value)
      return `Updated "${input.field}" successfully`
    })

    const readRecord = toolDefinition({
      name: 'read_record',
      description: 'Read the current record data',
      inputSchema: z.object({}),
    }).server(async () => {
      return JSON.stringify(this.context.record, null, 2)
    })

    return [updateField, readRecord, ...this._tools, ...this.extraTools()]
  }

  // ── Run ────────────────────────────────────────────────

  /** Run the agent (non-streaming). Returns the final response. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async run(ctx: ResourceAgentContext, input?: string): Promise<any> {
    this.context = ctx
    await this.beforeRun?.(ctx)

    const { agent: agentFn } = await loadAi()
    const tools = await this.buildTools()

    const a = agentFn({
      instructions: this.resolveInstructions(),
      tools,
      model: this._model,
    })

    const result = await a.prompt(input ?? 'Run your task on this record.')
    await this.afterRun?.(ctx, result)
    return result
  }

  /** Run the agent with SSE streaming. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async stream(ctx: ResourceAgentContext, input?: string): Promise<{ stream: AsyncIterable<any>; response: Promise<any> }> {
    this.context = ctx
    await this.beforeRun?.(ctx)

    const { agent: agentFn } = await loadAi()
    const tools = await this.buildTools()

    const a = agentFn({
      instructions: this.resolveInstructions(),
      tools,
      model: this._model,
    })

    return a.stream(input ?? 'Run your task on this record.')
  }

  // ── Meta ───────────────────────────────────────────────

  getSlug(): string { return this._slug }

  /** Serialise for the resource meta endpoint. */
  toMeta(): ResourceAgentMeta {
    return {
      slug:   this._slug,
      label:  this._label,
      icon:   this._icon,
      fields: this._fields,
    }
  }
}
