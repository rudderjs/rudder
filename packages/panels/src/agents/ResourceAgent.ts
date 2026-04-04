import type { ResourceAgentMeta } from './types.js'

// ─── Lazy imports (optional peer deps) ─────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

let _ai: { agent: any; toolDefinition: any; z: any } | undefined

async function loadAi() {
  if (!_ai) {
    const ai  = await import(/* @vite-ignore */ '@rudderjs/ai') as any
    const zod = await import(/* @vite-ignore */ 'zod') as any
    _ai = { agent: ai.agent, toolDefinition: ai.toolDefinition, z: zod.z }
  }
  return _ai!
}

async function loadLive() {
  const mod = await import(/* @vite-ignore */ '@rudderjs/live') as any
  return mod.Live as {
    updateMap(docName: string, mapName: string, field: string, value: unknown): Promise<void>
    readMap(docName: string, mapName: string): Record<string, unknown>
    readText(docName: string): string
    editText(docName: string, operation: unknown, aiCursor?: { name: string; color: string }): boolean
    editBlock(docName: string, blockType: string, blockIndex: number, field: string, value: unknown): boolean
    setAiAwareness(docName: string, state: { name: string; color: string }): void
    clearAiAwareness(docName: string): void
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Runtime context ────────────────────────────────────────

export interface ResourceAgentContext {
  record:       Record<string, unknown>
  resourceSlug: string
  recordId:     string
  panelSlug:    string
  /** Field type metadata — keyed by field name. Used to route edit_text between Yjs and Y.Map. */
  fieldMeta?:   Record<string, { type: string; yjs: boolean }>
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
    const docName = `panel:${this.context.resourceSlug}:${this.context.recordId}`

    const updateField = toolDefinition({
      name: 'update_field',
      description: 'Update a field on the current record. Available fields: ' + allFields.join(', '),
      inputSchema: z.object({
        field: z.enum(allFields as [string, ...string[]]),
        value: z.string().describe('The new value for the field'),
      }),
    }).server(async (input: { field: string; value: string }) => {
      // Set agent lock flag before writing
      await Live.updateMap(docName, 'fields', `__agent:${input.field}`, `AI: ${this._label}`)
      // Write the value
      await Live.updateMap(docName, 'fields', input.field, input.value)
      // Clear lock flag
      await Live.updateMap(docName, 'fields', `__agent:${input.field}`, null)
      return `Updated "${input.field}" successfully`
    })

    const readRecord = toolDefinition({
      name: 'read_record',
      description: 'Read the current record data (includes unsaved edits)',
      inputSchema: z.object({}),
    }).server(async () => {
      // Merge Yjs fields on top of DB record to include unsaved edits
      const merged = { ...this.context.record }
      try {
        const yjsFields = Live.readMap(docName, 'fields')
        for (const [key, value] of Object.entries(yjsFields)) {
          if (!key.startsWith('__agent:') && value != null) {
            merged[key] = value
          }
        }
      } catch { /* Live room may not exist yet */ }

      // Read text content from collaborative text/richcontent fields
      // (their content lives in separate Y.Doc rooms, not the form Y.Map)
      if (this.context.fieldMeta) {
        for (const [fieldName, meta] of Object.entries(this.context.fieldMeta)) {
          if (!meta.yjs) continue
          if (meta.type !== 'richcontent' && meta.type !== 'textarea' && meta.type !== 'text') continue
          try {
            const fragment = meta.type === 'richcontent' ? 'richcontent' : 'text'
            const fieldDocName = `${docName}:${fragment}:${fieldName}`
            const text = Live.readText(fieldDocName)
            if (text) merged[fieldName] = text
          } catch { /* room may not exist */ }
        }
      }

      return JSON.stringify(merged, null, 2)
    })

    const editText = toolDefinition({
      name: 'edit_text',
      description: [
        'Surgically edit text or blocks in a field without replacing all content.',
        'Use for rich text or long text fields where you want to change specific words, sentences, or block fields.',
        'For short fields like titles or slugs, use update_field instead.',
        'For embedded blocks (callToAction, video, etc.), use the update_block operation type.',
        'Available fields: ' + allFields.join(', '),
      ].join(' '),
      inputSchema: z.object({
        field: z.enum(allFields as [string, ...string[]]),
        operations: z.array(z.union([
          z.object({
            type: z.literal('replace'),
            search: z.string().describe('The exact text to find (must match exactly)'),
            replace: z.string().describe('The replacement text'),
          }),
          z.object({
            type: z.literal('insert_after'),
            search: z.string().describe('The text to find — new text will be inserted after it'),
            text: z.string().describe('The text to insert'),
          }),
          z.object({
            type: z.literal('delete'),
            search: z.string().describe('The exact text to delete'),
          }),
          z.object({
            type: z.literal('update_block'),
            blockType: z.string().describe('The block type (e.g. "callToAction", "video")'),
            blockIndex: z.number().describe('0-based index if multiple blocks of the same type'),
            field: z.string().describe('The block field to update (e.g. "title", "buttonText")'),
            value: z.string().describe('The new value'),
          }),
        ])),
      }),
    }).server(async (input: { field: string; operations: Array<Record<string, unknown>> }) => {
      const fieldInfo = this.context.fieldMeta?.[input.field]
      const isCollab = fieldInfo?.yjs === true

      if (isCollab) {
        // ── Collaborative field: edit Y.XmlText / Y.XmlElement directly ──
        const fragment = fieldInfo.type === 'richcontent' ? 'richcontent' : 'text'
        const fieldDocName = `${docName}:${fragment}:${input.field}`
        const aiCursor = { name: `AI: ${this._label}`, color: '#8b5cf6' }

        let applied = 0
        for (const op of input.operations) {
          if (op.type === 'update_block') {
            if (Live.editBlock(fieldDocName, op.blockType as string, (op.blockIndex as number) ?? 0, op.field as string, op.value)) {
              applied++
            }
          } else {
            if (Live.editText(fieldDocName, op as any, aiCursor)) {
              applied++
            }
          }
        }

        // Clear AI cursor after a delay so users see it
        setTimeout(() => Live.clearAiAwareness(fieldDocName), 2000)
        return `Applied ${applied}/${input.operations.length} edit(s) to "${input.field}"`

      } else {
        // ── Non-collaborative field: apply string ops and write to Y.Map ──
        let current = String(this.context.record[input.field] ?? '')

        // Read latest from Yjs if available
        try {
          const yjsFields = Live.readMap(docName, 'fields')
          if (yjsFields[input.field] != null) current = String(yjsFields[input.field])
        } catch { /* Live not available */ }

        for (const op of input.operations) {
          if (op.type === 'update_block') continue // Blocks only exist in collab fields
          const search = op.search as string
          if (op.type === 'replace' && search) {
            current = current.replace(search, op.replace as string)
          } else if (op.type === 'insert_after' && search) {
            const idx = current.indexOf(search)
            if (idx !== -1) current = current.slice(0, idx + search.length) + (op.text as string) + current.slice(idx + search.length)
          } else if (op.type === 'delete' && search) {
            current = current.replace(search, '')
          }
        }

        await Live.updateMap(docName, 'fields', input.field, current)
        return `Updated "${input.field}" successfully`
      }
    })

    return [updateField, editText, readRecord, ...this._tools, ...this.extraTools()]
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
