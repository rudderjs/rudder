import type { AiMessage, AnyTool, ConversationStoreMeta } from '@rudderjs/ai'
import type { PanelAgent, PanelAgentContext } from '../../../agents/PanelAgent.js'
import type { ModelClass, RecordRow } from '../../../types.js'
import type { ChatContext } from './types.js'
import type { ResolveContextDeps } from './resolveContext.js'
import { ChatContextError } from './types.js'
import { extractUserId } from '../types.js'
import { buildContext } from '../../shared/context.js'
import { loadLive } from '../lazyImports.js'
import { buildRunAgentTool } from '../tools/runAgentTool.js'
import { buildEditTextTool } from '../tools/editTextTool.js'
import { buildReadFormStateTool } from '../tools/readFormStateTool.js'
import { buildUpdateFormStateTool } from '../tools/updateFormStateTool.js'
import { buildDeleteRecordTool } from '../tools/deleteRecordTool.js'
import { buildBuilderCatalogPrompt, extractBuilderCatalog } from '../blockCatalog.js'
import { buildSelectionInstructions } from '../selectionInstructions.js'
import type { FieldBlockAllowlist } from '../tools/editTextTool.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ResolvedResourceState {
  resourceSlug:     string
  recordId:         string
  record:           Record<string, unknown>
  agents:           PanelAgent[]
  agentCtx:         PanelAgentContext
  selection:        { field: string; text: string } | undefined
  userId:           string | undefined
  tools:            AnyTool[]
  /** Pre-rendered "Available block types" section, or '' if the resource has no builder fields. */
  builderCatalog:   string
}

/**
 * Chat scoped to a single record on a resource (the record-edit page chat).
 *
 * Lifted from the old `handleAiChat` in chatHandler.ts. The async work
 * (resource lookup, policy check, record load, Yjs overlay, tool construction)
 * happens in `create()`; the synchronous methods just read from resolved state.
 */
export class ResourceChatContext implements ChatContext {
  readonly kind = 'resource' as const

  private constructor(private readonly state: ResolvedResourceState) {}

  static async create(deps: ResolveContextDeps): Promise<ResourceChatContext> {
    const { body, panel, req } = deps
    const ctxBody = body.resourceContext!
    const { resourceSlug, recordId } = ctxBody

    // 1. Find the resource class
    const ResourceClass = panel.getResources().find(R => R.getSlug() === resourceSlug)
    if (!ResourceClass) {
      throw new ChatContextError(404, `Resource "${resourceSlug}" not found.`)
    }

    // 2. Policy check
    const resource = new ResourceClass()
    const policyCtx = buildContext(req)
    if (!await resource.policy('view', policyCtx)) {
      throw new ChatContextError(403, 'Forbidden.')
    }

    // 3. Load the record
    let record: Record<string, unknown> = {}
    const Model = ResourceClass.model as ModelClass<RecordRow> | undefined
    if (Model) {
      const raw = await Model.find(recordId)
      if (raw) {
        record = typeof (raw as any).toJSON === 'function'
          ? (raw as any).toJSON()
          : raw as Record<string, unknown>
      }
    }

    // 4. Overlay unsaved Yjs fields (lifted verbatim from chatHandler.ts:264-282)
    const fieldMeta = resource.getFieldMeta()
    try {
      const Live = await loadLive()
      const docName = `panel:${resourceSlug}:${recordId}`
      const yjsFields = Live.readMap(docName, 'fields')
      for (const [key, value] of Object.entries(yjsFields)) {
        if (!key.startsWith('__agent:') && value != null) {
          record[key] = value
        }
      }
      for (const [fieldName, meta] of Object.entries(fieldMeta)) {
        if (!meta.yjs) continue
        if (meta.type !== 'richcontent' && meta.type !== 'textarea' && meta.type !== 'text') continue
        try {
          const fragment = meta.type === 'richcontent' ? 'richcontent' : 'text'
          const text = Live.readText(`${docName}:${fragment}:${fieldName}`)
          if (text) record[fieldName] = text
        } catch { /* room may not exist */ }
      }
    } catch { /* Live not available */ }

    // 5. Resolve agents + agentCtx
    const agents = resource.agents()
    const agentCtx: PanelAgentContext = {
      record,
      resourceSlug,
      recordId,
      panelSlug: panel.getName(),
      fieldMeta: resource.getFieldMeta(),
    }

    // 6. Pre-build the tools (async — they import zod/ai and live)
    const message = body.message ?? ''
    const selection = body.selection

    const agentFieldNames = new Set(agents.flatMap(a => (a as any)._fields as string[]))
    const metaFieldNames = agentCtx.fieldMeta ? Object.keys(agentCtx.fieldMeta) : []
    const candidateFields = [...new Set([...agentFieldNames, ...metaFieldNames])]
    const allFields = candidateFields.filter(name => {
      const meta = agentCtx.fieldMeta?.[name]
      if (!meta) return true
      return !meta.readonly && !meta.hiddenFromEdit
    })

    // Build per-field block allowlist so editTextTool can reject hallucinated
    // block types regardless of what the system prompt taught the agent.
    const blockAllowlist: FieldBlockAllowlist = {}
    for (const entry of extractBuilderCatalog(resource)) {
      blockAllowlist[entry.fieldName] = new Set(entry.blocks.map(b => b.name))
    }

    const runAgentTool         = await buildRunAgentTool(agents, agentCtx, message, {
      userId:       extractUserId(req),
      resourceSlug,
      recordId,
    })
    const editTextTool         = await buildEditTextTool(agentCtx, allFields, record, selection, blockAllowlist)
    const readFormStateTool    = await buildReadFormStateTool()
    const updateFormStateTool  = await buildUpdateFormStateTool(allFields)
    const deleteRecordTool     = Model
      ? await buildDeleteRecordTool({ Model, recordId })
      : null

    // Selection mode is a one-shot scoped edit. Restrict the toolkit to
    // `update_form_state` (the write path) and `read_form_state` (read-only,
    // safe). Hiding `delete_record` / `edit_text` / `run_agent` is defense in
    // depth: even if the model misreads the user's intent (e.g. parses "delete
    // selected" as "delete the record"), it can't escalate beyond the
    // selection because the destructive tools simply aren't in its toolkit.
    // The system prompt also tells it to stop after the edit; this is the
    // belt-and-suspenders backup.
    const tools: AnyTool[] = selection
      ? [
          readFormStateTool,
          ...(updateFormStateTool  ? [updateFormStateTool] : []),
        ]
      : [
          ...(runAgentTool         ? [runAgentTool]        : []),
          ...(editTextTool         ? [editTextTool]        : []),
          readFormStateTool,
          ...(updateFormStateTool  ? [updateFormStateTool] : []),
          ...(deleteRecordTool     ? [deleteRecordTool]    : []),
        ]

    // 8. Pre-render the builder block catalog (LSP-style structured metadata
    //    so the agent doesn't infer block types from raw Lexical JSON).
    const builderCatalog = buildBuilderCatalogPrompt(resource)

    return new ResourceChatContext({
      resourceSlug,
      recordId,
      record,
      agents,
      agentCtx,
      selection,
      userId: extractUserId(req),
      tools,
      builderCatalog,
    })
  }

  /** Reuses the resolved agentCtx (no longer used by dispatcher; retained for completeness). */
  getAgentContext(): PanelAgentContext {
    return this.state.agentCtx
  }

  buildSystemPrompt(): string {
    const { agents, record, selection, builderCatalog } = this.state
    const hasAgents = agents.length > 0
    const agentList = agents
      .map(a => `- "${(a as any)._label}" (slug: ${a.getSlug()}) — fields: ${(a as any)._fields.join(', ')}`)
      .join('\n')

    if (selection) {
      // Selection mode is built from the shared `buildSelectionInstructions`
      // helper so chat and the standalone path use one source of truth and
      // can't drift. See `feedback_chat_selection_mode_prompt.md` for the
      // bug that motivated extracting this. Callers must ALSO filter the
      // toolkit (below, in `resolveContext`) — the prompt is the soft
      // defense, the toolkit filter is the structural one.
      return [
        'You are an AI assistant that edits text fields in an admin panel.',
        '',
        buildSelectionInstructions(selection),
      ].join('\n')
    }

    return [
      'You are a helpful AI assistant for an admin panel.',
      '',
      '## Current Record (LIVE — always trust this over conversation history)',
      'This data is freshly loaded and reflects the latest state, including edits made by the user or other agents since your last response.',
      '```json',
      JSON.stringify(record, null, 2),
      '```',
      '',
      ...(hasAgents ? [
        '## Available Agents',
        agentList,
        '',
        'If the user\'s request maps to one of the available agents, call the `run_agent` tool with the agent slug.',
      ] : []),
      'If the user asks to edit, replace, insert, or delete specific text in a field, use one of the edit tools below.',
      '',
      '## Editing fields — `edit_text` vs `update_form_state`',
      '',
      'You have TWO write tools that overlap. Pick deliberately:',
      '',
      '- **`update_form_state`** — routes the edit through the user\'s browser. Use this for:',
      '  (a) non-collaborative fields,',
      '  (b) non-text field types (`select`, `boolean`, `number`, `date`, `tags`, `relation`),',
      '  (c) any field where the user has unsaved local changes you want to preserve, or',
      '  (d) the field the user is actively editing right now.',
      '  This is the safer default. It always sees the user\'s in-progress edits.',
      '',
      '- **`edit_text`** — mutates the server-side Y.Doc directly. Faster (no browser round-trip),',
      '  but only works on collaborative text/rich-content fields and CANNOT touch select/boolean/',
      '  number/date fields. Prefer this when the field is collaborative AND the user is not actively',
      '  editing it (e.g. background rewrites of body content while the user is typing in the title).',
      '',
      '- **Block operations** (`insert_block` / `update_block` / `delete_block`) work in BOTH tools',
      '  for rich-content fields. Prefer `update_form_state` if the user is actively editing that',
      '  field; prefer `edit_text` otherwise.',
      '',
      '## Rich-text formatting (only via `update_form_state`)',
      '**HARD RULE:** any request to bold, italicize, underline, strikethrough, code-format, link, unlink, or change a paragraph\'s type (heading, quote, code, list) MUST use `update_form_state`. `edit_text` has NO formatting ops — if you call it for a formatting request, you will silently fail and lie to the user. There is no exception.',
      '',
      'On Lexical text/rich-content fields, `update_form_state` exposes formatting operations that `edit_text` does not:',
      '- `format_text` — apply or remove bold/italic/underline/strikethrough/code on a matched text range. `marks` keys default to "leave unchanged"; pass `true` to apply, `false` to remove.',
      '- `set_link` / `unset_link` — wrap a matched substring in a link, or unwrap an existing link.',
      '- `set_paragraph_type` — convert a paragraph to a heading (`h1`–`h6`), `quote`, `code`, or back to plain `paragraph`. Locate the target via `selector: { paragraphIndex: N }` (0-based) or `selector: { textContains: "..." }` (first paragraph whose text contains the substring).',
      '- `insert_paragraph` — append (or insert at `position`) a plain-text paragraph.',
      '',
      'Examples: "bold the word \'critical\' in the body" → `format_text` with `search: "critical"` and `marks: { bold: true }`. "make the first paragraph an h1" → `set_paragraph_type` with `selector: { paragraphIndex: 0 }` and `paragraphType: "h1"`. "link the word \'subscribe\' to /sub" → `set_link` with `search: "subscribe"`, `url: "/sub"`.',
      '',
      '## Reading the user\'s in-progress edits',
      'The "Current Record" snapshot above includes saved DB values + collaborative (Yjs) field overlays — but it does NOT include unsaved edits to non-collaborative fields, which live only in the user\'s browser form state. An empty or missing value in the snapshot does NOT mean the field is actually empty — it may just be unsaved.',
      '**HARD RULE:** whenever the user asks about the current value of a field ("what is X", "show me X", "is X set", "what did I write in X", etc.), you MUST call `read_form_state` with that field name first, and answer from its result. Never answer field-value questions from the snapshot alone — the snapshot is a starting point, not the source of truth for questions about "current" values.',
      '',
      '## Deleting records',
      'If the user asks you to delete the current record, you MUST call the `delete_record` tool immediately — do NOT ask the user for confirmation in chat. The tool itself has a built-in approval gate: the browser will show an inline Approve/Reject card on the tool call, the user clicks one, and the agent loop resumes. Asking the user "are you sure?" in plain text wastes a turn and bypasses the approval flow.',
      '',
      ...(builderCatalog ? [
        builderCatalog,
        '',
        'Do NOT use `replace` operations to edit block fields — block data is not searchable text. Do NOT use `update_field` on rich text fields — it would overwrite the entire content.',
        '',
      ] : [
        '## Block editing',
        'Rich text fields may contain embedded blocks shown as `[BLOCK: type | field: "value", ...]` in the record. This resource has no builder fields with declared block types — if you encounter blocks, ask the user to clarify rather than guessing block names from the rendered placeholders.',
        '',
      ]),
      'Be concise and helpful.',
    ].join('\n')
  }

  buildTools(): AnyTool[] {
    return this.state.tools
  }

  getConversationMeta(): ConversationStoreMeta {
    const meta: ConversationStoreMeta = {
      resourceSlug: this.state.resourceSlug,
      recordId:     this.state.recordId,
    }
    if (this.state.userId) meta.userId = this.state.userId
    return meta
  }

  shouldLoadHistory(): boolean {
    // Selection mode is a one-shot edit, not a multi-turn conversation
    return !this.state.selection
  }

  transformUserInput(input: string, history: AiMessage[]): string {
    const { record, selection } = this.state
    if (history.length > 0 && !selection && Object.keys(record).length > 0) {
      return `${input}\n\n[Current record state: ${JSON.stringify(record)}]`
    }
    return input
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
