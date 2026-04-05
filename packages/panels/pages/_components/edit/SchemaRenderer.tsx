import { useState, useRef, useEffect, useCallback } from 'react'
import type { FieldMeta, SectionMeta, TabsMeta, PanelI18n } from '@rudderjs/panels'
import { Tabs, TabsPanel, TabsPanels, TabsList, TabsTab } from '@/components/animate-ui/components/base/tabs.js'
import { FieldInput } from '../FieldInput.js'
import { useAiChatSafe } from '../agents/AiChatContext.js'
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
  // Collaborative props (optional)
  userName?:   string
  userColor?:  string
  /** WebSocket path for live collaboration */
  wsPath?:     string | null
  /** Base document name for live collaboration */
  docName?:    string | null
}

// ─── Predefined quick action labels ─────────────────────────

const QUICK_ACTION_LABELS: Record<string, { label: string; prompt: string }> = {
  rewrite:       { label: 'Rewrite',      prompt: 'Rewrite the following text while keeping the same meaning' },
  expand:        { label: 'Expand',        prompt: 'Expand the following text with more detail' },
  shorten:       { label: 'Shorten',       prompt: 'Shorten the following text while keeping the key points' },
  'fix-grammar': { label: 'Fix grammar',   prompt: 'Fix any grammar and spelling mistakes in the following text' },
  translate:     { label: 'Translate',      prompt: 'Translate the following text to English' },
  summarize:     { label: 'Summarize',      prompt: 'Summarize the following text concisely' },
  'make-formal': { label: 'Make formal',    prompt: 'Rewrite the following text in a more formal tone' },
  simplify:      { label: 'Simplify',       prompt: 'Simplify the following text so it is easier to understand' },
}

// ─── AI quick actions button ────────────────────────────────

function AiQuickActions({ field, value }: { field: FieldMeta; value: unknown }) {
  const aiChat = useAiChatSafe()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const handleAction = useCallback((prompt: string) => {
    if (!aiChat) return
    const text = String(value ?? '')
    if (!text) return
    aiChat.setSelection({ field: field.name, text })
    aiChat.setOpen(true)
    // Small delay so selection is set before sendMessage reads it
    setTimeout(() => {
      aiChat.sendMessage(prompt)
    }, 0)
    setOpen(false)
  }, [aiChat, field.name, value])

  if (!aiChat || !field.ai) return null

  const actions = Array.isArray(field.ai)
    ? field.ai.map(id => QUICK_ACTION_LABELS[id] ?? { label: id, prompt: id }).filter(Boolean)
    : Object.values(QUICK_ACTION_LABELS).slice(0, 4) // default set when .ai(true)

  return (
    <div ref={ref} className="relative inline-flex ml-1.5">
      <button
        type="button"
        className="inline-flex items-center justify-center h-4 w-4 rounded text-primary/60 hover:text-primary hover:bg-primary/10 transition-colors"
        title="AI actions"
        onClick={() => setOpen(!open)}
      >
        <span className="text-xs leading-none">✦</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 min-w-[140px] rounded-md border bg-popover shadow-md z-30 py-1">
          {actions.map(a => (
            <button
              key={a.label}
              type="button"
              className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-muted/50 text-left"
              onClick={() => handleAction(a.prompt)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Schema renderer ────────────────────────────────────────

export function SchemaRenderer({
  schema, values, errors, setValue, uploadBase, i18n, mode,
  userName, userColor, wsPath, docName,
}: Props) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

  function renderField(field: FieldMeta) {
    if (!isFieldVisible(field as { conditions?: typeof field.conditions }, values)) return null
    const fieldDisabled = isFieldDisabled(field as { conditions?: typeof field.conditions }, values)
    return (
      <div key={field.name}>
        {field.type !== 'boolean' && field.type !== 'toggle' && field.type !== 'hidden' && (
          <label className="flex items-center text-sm font-medium mb-1.5">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
            <AiQuickActions field={field} value={values[field.name]} />
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
