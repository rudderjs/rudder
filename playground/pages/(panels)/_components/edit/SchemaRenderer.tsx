import { useState } from 'react'
import type { FieldMeta, SectionMeta, TabsMeta, PanelI18n, ResolvedAiAction } from '@pilotiq/panels'
import { useAiUi } from '@pilotiq/panels'
import { Tabs, TabsPanel, TabsPanels, TabsList, TabsTab } from '@/components/animate-ui/components/base/tabs.js'
import { FieldInput } from '../FieldInput.js'
import { readFieldSelection } from '../agents/readFieldSelection.js'
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

// ─── AI quick actions button ────────────────────────────────

interface AiQuickActionsProps {
  field:        FieldMeta
  apiBase:      string
  resourceSlug: string
  recordId:     string
}

/**
 * Field-level `✦` trigger. Opens the shared `AiDropdown` anchored below the
 * button. Captures the field's current text selection at click time so the
 * dropdown can render in selection-aware mode (header + scoped actions).
 *
 * The dropdown body — quick actions, chat-bridge item, free-form textarea —
 * lives in `AiDropdown` and is shared with the inline-trigger surfaces in
 * `panels-lexical` (`FloatingToolbarPlugin` for richcontent,
 * `SelectionAiPlugin` for collab plain text). Both triggers render the same
 * dropdown component with different anchor modes.
 */
function AiQuickActions({ field, apiBase, resourceSlug, recordId }: AiQuickActionsProps) {
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState<{ text: string } | null>(null)
  // AiDropdown is contributed by `@pilotiq-pro/ai` via the AiUiContext slot
  // bag. Undefined when pro is not installed — the field trigger then has
  // nothing to render and bails below.
  const { AiDropdown } = useAiUi()

  // Capture selection at the moment the dropdown opens. The browser preserves
  // selectionStart/End on plain inputs across blur, and Lexical preserves its
  // RangeSelection across focus changes — so reading at click time captures
  // whatever the user had highlighted before they reached for the ✦ button.
  function openDropdown() {
    setSelection(readFieldSelection(field.name))
    setOpen(true)
  }

  function closeDropdown() {
    setOpen(false)
    setSelection(null)
  }

  if (!field.ai) return null

  const actions: ResolvedAiAction[] = Array.isArray(field.ai) ? field.ai : []
  if (actions.length === 0) return null
  // No pro package installed → no dropdown to render → hide the trigger
  // entirely. Keeps the label tidy instead of showing a dead ✦ button.
  if (!AiDropdown) return null

  return (
    <div className="relative inline-flex ml-1.5">
      <button
        type="button"
        className="inline-flex items-center justify-center h-4 w-4 rounded text-primary/60 hover:text-primary hover:bg-primary/10 transition-colors"
        title="AI actions"
        onClick={() => open ? closeDropdown() : openDropdown()}
      >
        <span className="text-xs leading-none">✦</span>
      </button>
      {open && (
        <AiDropdown
          fieldName={field.name}
          actions={actions}
          apiBase={apiBase}
          resourceSlug={resourceSlug}
          recordId={recordId}
          selection={selection}
          position={{ mode: 'absolute' }}
          onClose={closeDropdown}
        />
      )}
    </div>
  )
}

// ─── AI action progress popover ─────────────────────────────

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

  // NB: the standalone `PanelAgentApiProvider` that used to wrap this tree
  // has moved to `@pilotiq-pro/ai` — pro's own provider now supplies the
  // apiBase / resourceSlug / recordId that inline AI surfaces (collab text
  // inputs + rich content) need. Free field inputs no longer read that
  // context; when pro is absent the inline ✦ affordances simply don't
  // render. The field-level ✦ trigger above still works because its api
  // params come from the `aiApiBase` / `aiResourceSlug` / `aiRecordId`
  // props on this component, which are populated by `SchemaForm` in edit
  // mode.

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
