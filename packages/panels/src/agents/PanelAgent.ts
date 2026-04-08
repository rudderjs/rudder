import type { PanelAgentMeta } from './types.js'

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
    rewriteText(docName: string, newText: string, aiCursor?: { name: string; color: string }): boolean
    setAiAwareness(docName: string, state: { name: string; color: string }): void
    clearAiAwareness(docName: string): void
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Runtime context ────────────────────────────────────────

export interface PanelAgentContext {
  record:       Record<string, unknown>
  resourceSlug: string
  recordId:     string
  panelSlug:    string
  /** Field type metadata — keyed by field name. Used to route edit_text between Yjs and Y.Map, and to enforce field-level edit permissions. */
  fieldMeta?:   Record<string, { type: string; yjs: boolean; readonly?: boolean; hiddenFromEdit?: boolean }>
  /**
   * Per-request field-scope override. When set, this list (instead of the
   * agent's `_fields`) is used to build the write tools' allowlist
   * (`update_field` / `edit_text` / `update_form_state`). This is how
   * **built-in actions** (`rewrite`, `shorten`, etc.) get scoped to the
   * single field that was clicked — built-ins have an empty `_fields`
   * because they don't know in advance which field they'll run against.
   */
  fieldScope?:  string[]
}

// ─── PanelAgent ─────────────────────────────────────────

/**
 * AI agent that operates on a panel resource record.
 *
 * Use the fluent builder for simple inline agents:
 * ```ts
 * PanelAgent.make('seo')
 *   .label('Improve SEO')
 *   .instructions('Analyse and improve SEO...')
 *   .fields(['title', 'slug', 'metaDescription'])
 * ```
 *
 * Or extend the class for complex agents with custom tools:
 * ```ts
 * class TranslateAgent extends PanelAgent {
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
/**
 * Field types a `PanelAgent` is allowed to operate on. Validated at field
 * registration time when the agent is referenced from `Field.ai([...])` —
 * see `D10` in `docs/plans/standalone-client-tools-plan.md`.
 *
 * Use `'*'` to mean "any field type" (default for agents that don't call
 * `.appliesTo([...])` explicitly).
 */
export type PanelAgentFieldType = '*' | string

export class PanelAgent {
  protected _slug:  string
  protected _label: string
  protected _icon?: string
  protected _instructions: string | ((record: Record<string, unknown>) => string) = ''
  protected _fields: string[] = []
  protected _model?: string
  protected _tools: Array<{ definition: { name: string }; type: string; execute: Function }> = []
  protected _appliesTo: PanelAgentFieldType[] = ['*']

  /** Runtime context — set before run/stream. */
  protected context!: PanelAgentContext

  constructor(slug: string) {
    this._slug  = slug
    this._label = slug
  }

  // ── Fluent builder ─────────────────────────────────────

  static make(slug: string): PanelAgent {
    return new PanelAgent(slug)
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

  /**
   * Declare which field types this agent can run against. Validated at
   * `Field.ai([...])` registration time — see D10 in
   * `docs/plans/standalone-client-tools-plan.md`. Default is `['*']` (any).
   *
   * @example
   * PanelAgent.make('rewrite')
   *   .appliesTo(['text', 'textarea', 'richcontent', 'content'])
   */
  appliesTo(types: PanelAgentFieldType[]): this {
    this._appliesTo = types.length > 0 ? types : ['*']
    return this
  }

  /** Add custom tools beyond the auto-generated field tools. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools(t: any[]): this {
    this._tools = t
    return this
  }

  // ── Override points for subclasses ─────────────────────

  /**
   * Override for dynamic instructions based on record data.
   *
   * Returns the user-supplied `.instructions(...)` text with two
   * augmentations:
   *
   * 1. **`{field}` interpolation** — built-in field actions (`rewrite`,
   *    `shorten`, etc.) and any custom agent that wants to render the
   *    active field name in its prompt can use `{field}` as a placeholder.
   *    Substituted with the first entry of `context.fieldScope` (set by
   *    the standalone endpoint when the user clicks an action on a
   *    specific field). Falls back to `_fields[0]`, then to "the active".
   *
   * 2. **Tool selection preamble** — auto-prepends rules that teach the
   *    model which write tool to use for which field type. Uses
   *    `context.fieldMeta` to be specific about which fields are
   *    collaborative vs. not, so the model knows that (e.g.) writing to
   *    `metaTitle` MUST go through `update_form_state` because it's a
   *    plain text field where the user might have unsaved edits. Without
   *    this, the model picks `update_field` (which writes to the DB and
   *    bypasses live React state) and the user sees no visible change.
   */
  resolveInstructions(): string {
    const raw = typeof this._instructions === 'function'
      ? this._instructions(this.context.record)
      : this._instructions

    // Substitute {field} placeholders.
    const fieldName =
      this.context.fieldScope?.[0] ??
      this._fields[0] ??
      'the active'
    const interpolated = raw.includes('{field}')
      ? raw.split('{field}').join(fieldName)
      : raw

    // Build the tool selection preamble. Reads context.fieldMeta to
    // partition the agent's allowed fields into "collab text" vs
    // "non-collab" so the rules can name them explicitly.
    const allFields = this.context.fieldScope && this.context.fieldScope.length > 0
      ? this.context.fieldScope
      : this._fields
    const preamble = buildToolSelectionPreamble(allFields, this.context.fieldMeta)
    return preamble ? `${preamble}\n\n${interpolated}` : interpolated
  }

  /** Override to provide additional tools beyond field update tools. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraTools(): any[] {
    return []
  }

  /** Called before the agent runs. Throw to abort. */
  async beforeRun?(_ctx: PanelAgentContext): Promise<void>

  /** Called after the agent completes. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async afterRun?(_ctx: PanelAgentContext, _result: any): Promise<void>

  // ── Build tools ────────────────────────────────────────

  /** @internal — builds auto-generated field tools + custom tools. */
  protected async buildTools() {
    const { toolDefinition, z } = await loadAi()
    const Live = await loadLive()

    // Field-scope override (`PanelAgentContext.fieldScope`) wins over the
    // agent's declared `_fields`. Built-in actions like `rewrite` use this
    // path: they have empty `_fields` and the standalone endpoint sets the
    // scope to `[clickedFieldName]` from the request body.
    const allFields = this.context.fieldScope && this.context.fieldScope.length > 0
      ? this.context.fieldScope
      : this._fields
    const docName = `panel:${this.context.resourceSlug}:${this.context.recordId}`

    const updateField = toolDefinition({
      name: 'update_field',
      description: [
        '⚠️ HEADLESS-ONLY write tool. Writes directly to the database / Y.Doc, bypassing the user\'s live React form state.',
        '🚫 DO NOT CALL THIS TOOL when there is a user interacting with the page. They will see NO visible change.',
        '✅ Use `update_form_state` instead — it routes through the live form state so the user actually sees the change.',
        'This tool exists ONLY for headless runs (cron jobs, queue workers, background scripts) where no browser is connected.',
        'Available fields: ' + allFields.join(', '),
      ].join(' '),
      inputSchema: z.object({
        field: z.enum(allFields as [string, ...string[]]),
        value: z.unknown().describe('The new value — any JSON type matching the field schema'),
      }),
    }).server(async (input: { field: string; value: unknown }) => {
      const fieldInfo = this.context.fieldMeta?.[input.field]
      const isCollabText = fieldInfo?.yjs === true && (
        fieldInfo.type === 'richcontent' ||
        fieldInfo.type === 'textarea'    ||
        fieldInfo.type === 'text'
      )

      // Set agent lock flag (visible in UI as "AI: <label>" highlight)
      await Live.updateMap(docName, 'fields', `__agent:${input.field}`, `AI: ${this._label}`)
      try {
        if (isCollabText) {
          // Collab text/richcontent fields live in per-field Y.XmlText rooms,
          // not the form Y.Map. Y.Map writes for these are silently lost
          // because the editor doesn't read from there. Route through
          // Live.rewriteText against the per-field room — same path the
          // chat-level edit_text `rewrite` op uses.
          const fragment = fieldInfo!.type === 'richcontent' ? 'richcontent' : 'text'
          const fieldDocName = `${docName}:${fragment}:${input.field}`
          const text = typeof input.value === 'string' ? input.value : String(input.value ?? '')
          const aiCursor = { name: `AI: ${this._label}`, color: '#8b5cf6' }
          Live.rewriteText(fieldDocName, text, aiCursor)
          setTimeout(() => Live.clearAiAwareness(fieldDocName), 2000)
        } else {
          // Plain field — booleans/selects/numbers/dates/tags/json plus
          // non-collab text. Stored in the form Y.Map. Pass the typed value
          // through unchanged so booleans stay booleans, arrays stay arrays.
          await Live.updateMap(docName, 'fields', input.field, input.value)
        }
      } finally {
        await Live.updateMap(docName, 'fields', `__agent:${input.field}`, null)
      }
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
        '⚠️ HEADLESS-ONLY tool. Edits text/blocks in a field by writing directly to the Y.Doc.',
        '🚫 DO NOT CALL THIS TOOL when there is a user interacting with the page — use `update_form_state` instead.',
        '`update_form_state` has all of these operations PLUS formatting (bold/italic/links/paragraph types) AND it routes through the user\'s live React/Lexical state so the user actually sees the change.',
        'This tool exists ONLY for headless runs (cron jobs, queue workers, background scripts) where no browser is connected.',
        'Available fields: ' + allFields.join(', '),
      ].join(' '),
      inputSchema: z.object({
        field: z.enum(allFields as [string, ...string[]]),
        operations: z.array(z.union([
          z.object({
            type: z.literal('rewrite'),
            content: z.string().describe('The complete new text content — replaces everything in the field'),
          }),
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
          if (op.type === 'rewrite') {
            if (Live.rewriteText(fieldDocName, op.content as string, aiCursor)) {
              applied++
            }
          } else if (op.type === 'update_block') {
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
          if (op.type === 'rewrite') {
            current = op.content as string
            continue
          }
          const search = op.search as string
          if (op.type === 'replace' && search) {
            current = current.replace(search, () => op.replace as string)
          } else if (op.type === 'insert_after' && search) {
            const idx = current.indexOf(search)
            if (idx !== -1) current = current.slice(0, idx + search.length) + (op.text as string) + current.slice(idx + search.length)
          } else if (op.type === 'delete' && search) {
            current = current.replace(search, () => '')
          }
        }

        await Live.updateMap(docName, 'fields', input.field, current)
        return `Updated "${input.field}" successfully`
      }
    })

    // Q6 (standalone-client-tools-plan): every PanelAgent gets the client-side
    // form-state tools by default. They live in `chat/tools/` for historical
    // reasons but are not chat-specific — `update_form_state` is the only
    // sane way to write a non-collaborative field without clobbering unsaved
    // local edits, so it must be available on the standalone path too.
    const { buildUpdateFormStateTool } = await import('../handlers/chat/tools/updateFormStateTool.js')
    const { buildReadFormStateTool }   = await import('../handlers/chat/tools/readFormStateTool.js')
    const updateFormStateTool = await buildUpdateFormStateTool(allFields)
    const readFormStateTool   = await buildReadFormStateTool()

    return [
      updateField,
      editText,
      readRecord,
      ...(updateFormStateTool ? [updateFormStateTool] : []),
      readFormStateTool,
      ...this._tools,
      ...this.extraTools(),
    ]
  }

  // ── Run ────────────────────────────────────────────────

  /** Run the agent (non-streaming). Returns the final response. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async run(ctx: PanelAgentContext, input?: string): Promise<any> {
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

  /**
   * Run the agent with SSE streaming.
   *
   * Pass `opts` to forward `@rudderjs/ai`'s `AgentPromptOptions` (used by the
   * standalone runner to enable client-tool round-trips via
   * `toolCallStreamingMode: 'stop-on-client-tool'`, plus `messages` /
   * `approvedToolCallIds` / `rejectedToolCallIds` for continuations).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async stream(ctx: PanelAgentContext, input?: string, opts?: any): Promise<{ stream: AsyncIterable<any>; response: Promise<any> }> {
    this.context = ctx
    await this.beforeRun?.(ctx)

    const { agent: agentFn } = await loadAi()
    const tools = await this.buildTools()

    const a = agentFn({
      instructions: this.resolveInstructions(),
      tools,
      model: this._model,
    })

    return a.stream(input ?? 'Run your task on this record.', opts)
  }

  // ── Meta ───────────────────────────────────────────────

  getSlug():       string                    { return this._slug }
  getLabel():      string                    { return this._label }
  getIcon():       string | undefined        { return this._icon }
  getAppliesTo():  PanelAgentFieldType[]     { return this._appliesTo }

  /** Serialise for the resource meta endpoint. */
  toMeta(): PanelAgentMeta {
    return {
      slug:   this._slug,
      label:  this._label,
      icon:   this._icon,
      fields: this._fields,
    }
  }
}

// ─── Tool selection preamble ───────────────────────────────

/**
 * Build a system-prompt preamble that teaches the model which write tool to
 * use for which field. Auto-prepended by `PanelAgent.resolveInstructions()`.
 *
 * **Why this exists:** the standalone runner has no system-prompt
 * augmentation layer (chat does — see `ResourceChatContext.buildSystemPrompt`).
 * Without the preamble, agents pick `update_field` (DB write) for non-collab
 * fields and the user sees no visible change because the React form state
 * isn't refreshed. The chat path's tool selection rules need to live on the
 * agent itself so they apply equally to both surfaces.
 *
 * The preamble is built from the agent's actual `fieldMeta`, so it names
 * fields specifically: "field `metaTitle` is non-collaborative — write via
 * update_form_state" rather than abstract guidance the model might ignore.
 */
function buildToolSelectionPreamble(
  allFields: string[],
  fieldMeta: PanelAgentContext['fieldMeta'],
): string {
  if (!allFields || allFields.length === 0) return ''

  // Partition the fields by type for the per-field guidance line. We don't
  // change the rule based on collab vs non-collab anymore — the rule is
  // always the same: use update_form_state. The partition just lets us
  // explain *why* in the prompt (Lexical fields surface formatting ops via
  // update_form_state too).
  const richTextFields: string[] = []
  const plainFields:    string[] = []
  for (const name of allFields) {
    const meta = fieldMeta?.[name]
    const isRich = meta?.type === 'richcontent' || meta?.type === 'content'
    if (isRich) richTextFields.push(name)
    else        plainFields.push(name)
  }

  const lines = [
    '# Tool selection rules — READ BEFORE WRITING ANYTHING',
    '',
    'You have multiple write tools. **THERE IS A USER INTERACTING WITH THE PAGE RIGHT NOW** — picking the wrong tool will silently fail because their browser will not see your change.',
    '',
    '## ✅ ALWAYS USE `update_form_state` FOR WRITES',
    '',
    '`update_form_state` is the ONLY write tool that updates what the user actually sees on screen. It routes through the user\'s live React form state and Lexical editor instances. Every write you do MUST go through it.',
    '',
  ]

  if (plainFields.length > 0) {
    lines.push(
      `- For plain fields (${plainFields.join(', ')}): use \`update_form_state\` with a \`set_value\` operation.`,
    )
  }
  if (richTextFields.length > 0) {
    lines.push(
      `- For rich-text fields (${richTextFields.join(', ')}): use \`update_form_state\` with \`rewrite_text\` for whole replacements, or surgical ops (\`format_text\`, \`set_link\`, \`insert_paragraph\`, \`set_paragraph_type\`, block ops) for precise edits.`,
    )
  }

  lines.push(
    '',
    '## ❌ DO NOT USE `update_field` OR `edit_text`',
    '',
    '`update_field` writes to the database directly and bypasses the user\'s live form state. They will see NO visible change and may lose unsaved edits. `edit_text` writes to the Y.Doc directly and has the same problem for non-collab fields plus has no formatting operations.',
    '',
    'These two tools are for HEADLESS / BACKGROUND runs only (cron jobs, queue workers — when there is no browser open). When in doubt, they are wrong. Use `update_form_state`.',
    '',
    '## Reading',
    '',
    '- `read_record` — fast, reads from the database (good for context).',
    '- `read_form_state` — reads the user\'s live form values including unsaved edits (use when you need the latest visible state).',
  )

  return lines.join('\n')
}
