import { useState, useRef, useEffect } from 'react'
import type { FieldMeta, SectionMeta, TabsMeta, PanelI18n, ResolvedAiAction } from '@rudderjs/panels'
import { Tabs, TabsPanel, TabsPanels, TabsList, TabsTab } from '@/components/animate-ui/components/base/tabs.js'
import { FieldInput } from '../FieldInput.js'
import { useAgentRun } from '../agents/useAgentRun.js'
import { isFieldVisible, isFieldDisabled } from '../../_lib/conditions.js'
import type { SchemaItem } from '../../_lib/formHelpers.js'

interface Props {
  schema:      SchemaItem[]
  values:      Record<string, unknown>
  errors:      Record<string, string[]>
  setValue:    (name: string, value: unknown) => void
  uploadBase: string
  i18n:        PanelI18n & Record<string, string>
  mode:        'create' | 'edit'
  // ── AI quick action wiring (only set in edit mode) ──
  /** API base URL — `${panelPath}/api`. Used to POST to the standalone agent endpoint. */
  aiApiBase?:      string | undefined
  /** Resource slug for the standalone agent endpoint URL. */
  aiResourceSlug?: string | undefined
  /** Record id for the standalone agent endpoint URL. */
  aiRecordId?:     string | undefined
  // Collaborative props (optional)
  userName?:   string
  userColor?:  string
  /** WebSocket path for live collaboration */
  wsPath?:     string | null
  /** Base document name for live collaboration */
  docName?:    string | null
}

// ─── Translate language submenu ────────────────────────────

const TRANSLATE_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'Arabic' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'hi', label: 'Hindi' },
]

// ─── AI quick actions button ────────────────────────────────

interface AiQuickActionsProps {
  field:        FieldMeta
  apiBase:      string
  resourceSlug: string
  recordId:     string
}

function AiQuickActions({ field, apiBase, resourceSlug, recordId }: AiQuickActionsProps) {
  const [open, setOpen] = useState(false)
  const [translateOpen, setTranslateOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Standalone agent runner — POSTs to /_agents/${slug} with field-scope.
  // After Phase 5 the agent runs the action against the live form state via
  // update_form_state (client tool) — no chat panel involvement.
  const { run, reset, entries, status } = useAgentRun(apiBase, resourceSlug)

  // Auto-dismiss the success popover ~3s after a clean completion. Errors
  // stay until the user dismisses them so they don't get missed.
  useEffect(() => {
    if (status !== 'complete') return
    const timer = setTimeout(() => reset(), 3000)
    return () => clearTimeout(timer)
  }, [status, reset])

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  function handleAction(action: ResolvedAiAction, languageHint?: string) {
    // The agent reads the current field value from live form state via
    // `read_form_state` (client tool) and writes the result back via
    // `update_form_state`. The instructions interpolate `{field}` server-side.
    const input = languageHint
      ? `Translate the ${field.name} field to ${languageHint}.`
      : `Run the "${action.label}" action on the ${field.name} field.`
    run(action.slug, recordId, input, { field: field.name })
    setOpen(false)
    setTranslateOpen(false)
  }

  if (!field.ai) return null

  // `field.ai` is now `boolean | ResolvedAiAction[]` (Phase 4). The server
  // resolves slugs through `BuiltInAiActionRegistry` at form-build time and
  // ships ready-to-render metadata `{slug, label, icon?}`. The frontend no
  // longer holds a hardcoded prompt map.
  const actions: ResolvedAiAction[] = Array.isArray(field.ai) ? field.ai : []
  if (actions.length === 0) return null

  const isRunning   = status === 'running'
  const showProgress = entries.length > 0

  return (
    <div ref={ref} className="relative inline-flex ml-1.5">
      <button
        type="button"
        disabled={isRunning}
        className="inline-flex items-center justify-center h-4 w-4 rounded text-primary/60 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
        title={isRunning ? 'AI action running…' : 'AI actions'}
        onClick={() => { setOpen(!open); setTranslateOpen(false) }}
      >
        <span className={`text-xs leading-none ${isRunning ? 'animate-pulse' : ''}`}>✦</span>
      </button>
      {open && !showProgress && (
        <div className="absolute left-0 top-full mt-1 min-w-[140px] rounded-md border bg-popover shadow-md z-30 py-1">
          {actions.map(a => (
            a.slug === 'translate' ? (
              <div key={a.slug} className="relative">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-muted/50 text-left"
                  onClick={() => setTranslateOpen(!translateOpen)}
                >
                  {a.label}
                  <span className="text-[10px] text-muted-foreground ml-2">{'>'}</span>
                </button>
                {translateOpen && (
                  <div className="absolute left-full top-0 ml-1 min-w-[120px] rounded-md border bg-popover shadow-md z-30 py-1 max-h-64 overflow-y-auto">
                    {TRANSLATE_LANGUAGES.map(lang => (
                      <button
                        key={lang.code}
                        type="button"
                        className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-muted/50 text-left"
                        onClick={() => handleAction(a, lang.label)}
                      >
                        {lang.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button
                key={a.slug}
                type="button"
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-muted/50 text-left"
                onClick={() => handleAction(a)}
              >
                {a.label}
              </button>
            )
          ))}
        </div>
      )}
      {showProgress && (
        <AiActionProgress
          entries={entries}
          status={status}
          onDismiss={reset}
        />
      )}
    </div>
  )
}

// ─── AI action progress popover ─────────────────────────────

interface AiActionProgressEntry {
  type:    'text' | 'tool_call' | 'complete' | 'error'
  text?:   string
  tool?:   string
  input?:  Record<string, unknown>
  message?: string
}

interface AiActionProgressProps {
  entries:  AiActionProgressEntry[]
  status:   'idle' | 'running' | 'complete' | 'error'
  onDismiss: () => void
}

/**
 * Inline progress popover for an AI action run. Anchored below the field's
 * ✦ button. Shows streamed text deltas + tool-call indicators while the
 * agent is running, a checkmark + auto-dismiss on success, and a
 * persistent error card on failure.
 *
 * Per `feedback_inline_over_modal.md`: rendered inline next to the field,
 * not as a modal. Auto-dismisses on success so the user can keep working.
 */
function AiActionProgress({ entries, status, onDismiss }: AiActionProgressProps) {
  const isRunning  = status === 'running'
  const isError    = status === 'error'
  const isComplete = status === 'complete'

  return (
    <div
      className={`absolute left-0 top-full mt-1 w-72 rounded-md border shadow-md z-30 text-xs ${
        isError ? 'border-destructive/40 bg-destructive/5' : 'bg-popover'
      }`}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
        <div className="flex items-center gap-1.5 text-foreground/80 font-medium">
          {isRunning && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          )}
          {isComplete && (
            <svg className="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {isError && (
            <svg className="w-3 h-3 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
          <span>
            {isRunning && 'Working…'}
            {isComplete && 'Done'}
            {isError && 'Error'}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground text-base leading-none"
          title="Dismiss"
        >
          ×
        </button>
      </div>
      <div className="px-3 py-2 space-y-1.5 max-h-48 overflow-y-auto">
        {entries.map((entry, i) => {
          if (entry.type === 'text' && entry.text) {
            return (
              <div key={i} className="text-foreground/70 whitespace-pre-wrap leading-relaxed">
                {entry.text}
              </div>
            )
          }
          if (entry.type === 'tool_call' && entry.tool) {
            return (
              <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
                <svg className="w-3 h-3 text-primary/70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>{describeToolCall(entry.tool, entry.input)}</span>
              </div>
            )
          }
          if (entry.type === 'error') {
            return (
              <div key={i} className="text-destructive">
                {entry.message}
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

/** Map a tool name + args to a short human-readable description for the popover. */
function describeToolCall(tool: string, input?: Record<string, unknown>): string {
  const fieldArg = typeof input?.['field'] === 'string' ? (input['field'] as string) : undefined
  switch (tool) {
    case 'read_record':       return 'Read record'
    case 'read_form_state':   return 'Read form state'
    case 'update_field':      return fieldArg ? `Updated ${fieldArg}` : 'Updated field'
    case 'update_form_state': return fieldArg ? `Updated ${fieldArg}` : 'Updated field'
    case 'edit_text':         return fieldArg ? `Edited ${fieldArg}`  : 'Edited text'
    default:                  return `Called ${tool}`
  }
}

// ─── Schema renderer ────────────────────────────────────────

export function SchemaRenderer({
  schema, values, errors, setValue, uploadBase, i18n, mode,
  aiApiBase, aiResourceSlug, aiRecordId,
  userName, userColor, wsPath, docName,
}: Props) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

  function renderField(field: FieldMeta) {
    if (!isFieldVisible(field as { conditions?: typeof field.conditions }, values)) return null
    const fieldDisabled = isFieldDisabled(field as { conditions?: typeof field.conditions }, values)
    const canRunAi = !!aiApiBase && !!aiResourceSlug && !!aiRecordId
    return (
      <div key={field.name}>
        {field.type !== 'boolean' && field.type !== 'toggle' && field.type !== 'hidden' && (
          <label className="flex items-center text-sm font-medium mb-1.5">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
            {canRunAi && (
              <AiQuickActions
                field={field}
                apiBase={aiApiBase!}
                resourceSlug={aiResourceSlug!}
                recordId={aiRecordId!}
              />
            )}
          </label>
        )}
        <FieldInput
          field={field}
          value={values[field.name]}
          onChange={(v: unknown) => setValue(field.name, v)}
          uploadBase={uploadBase}
          i18n={i18n}
          disabled={fieldDisabled}
          formValues={values}
          {...(userName !== undefined ? { userName } : {})}
          {...(userColor !== undefined ? { userColor } : {})}
          {...(wsPath !== undefined ? { wsPath } : {})}
          {...(docName !== undefined ? { docName } : {})}
        />
        {errors[field.name]?.map((e) => (
          <p key={e} className="mt-1 text-xs text-destructive">{e}</p>
        ))}
      </div>
    )
  }

  function renderSchemaItem(item: SchemaItem, index: number) {
    if (item.type === 'section') {
      const section = item as SectionMeta
      const key     = `section-${index}`
      const fields  = section.fields.filter((f) => !f.hidden?.includes(mode) && isFieldVisible(f, values))
      if (fields.length === 0) return null
      const open    = section.collapsible ? !(collapsedSections[key] ?? section.collapsed) : true

      const gridCls = section.columns === 2 ? 'grid grid-cols-2 gap-4'
                    : section.columns === 3 ? 'grid grid-cols-3 gap-4'
                    : 'flex flex-col gap-4'

      return (
        <div key={key} className="rounded-xl border border-border bg-card">
          <div
            className={['flex items-center justify-between px-5 py-3 bg-muted/40 border-b border-border', section.collapsible ? 'cursor-pointer select-none' : ''].join(' ')}
            onClick={() => section.collapsible && setCollapsedSections((p) => ({ ...p, [key]: !(p[key] ?? section.collapsed) }))}
          >
            <div>
              <p className="text-sm font-semibold">{section.title}</p>
              {section.description && <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>}
            </div>
            {section.collapsible && (
              <span className="text-muted-foreground text-sm">{open ? '▲' : '▼'}</span>
            )}
          </div>
          {open && (
            <div className={`p-5 ${gridCls}`}>
              {fields.map((f) => renderField(f))}
            </div>
          )}
        </div>
      )
    }

    if (item.type === 'tabs') {
      const tabsMeta = item as TabsMeta
      const key = `tabs-${index}`
      return (
        <Tabs key={key} defaultValue={tabsMeta.tabs[0]?.label} className="rounded-xl border border-border bg-card">
          <TabsList className="w-full justify-start rounded-none border-b bg-muted/40 px-2">
            {tabsMeta.tabs.map((tab) => (
              <TabsTab key={tab.label} value={tab.label} className="text-sm">
                {tab.label}
              </TabsTab>
            ))}
          </TabsList>
          <TabsPanels>
            {tabsMeta.tabs.map((tab) => (
              <TabsPanel key={tab.label} value={tab.label} className="p-5 flex flex-col gap-4">
                {tab.fields
                  .filter((f) => !f.hidden?.includes(mode) && isFieldVisible(f, values))
                  .map((f) => renderField(f))
                }
              </TabsPanel>
            ))}
          </TabsPanels>
        </Tabs>
      )
    }

    return renderField(item as FieldMeta)
  }

  return (
    <>
      {schema
        .filter((item) => {
          if (item.type === 'section' || item.type === 'tabs') return true
          return !(item as FieldMeta).hidden?.includes(mode)
        })
        .map((item, i) => renderSchemaItem(item, i))
      }
    </>
  )
}
