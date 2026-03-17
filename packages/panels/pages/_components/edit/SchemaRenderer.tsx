import { useState } from 'react'
import type { FieldMeta, SectionMeta, TabsMeta, PanelI18n } from '@boostkit/panels'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.js'
import { FieldInput } from '../FieldInput.js'
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
          <label className="block text-sm font-medium mb-1.5">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </label>
        )}
        <FieldInput
          field={field}
          value={values[field.name]}
          onChange={(v: unknown) => setValue(field.name, v)}
          uploadBase={uploadBase}
          i18n={i18n}
          disabled={fieldDisabled}
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
      const fields  = section.fields.filter((f) => !f.hidden.includes(mode) && isFieldVisible(f as any, values))
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
              <TabsTrigger key={tab.label} value={tab.label} className="text-sm">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabsMeta.tabs.map((tab) => (
            <TabsContent key={tab.label} value={tab.label} className="p-5 flex flex-col gap-4 mt-0">
              {tab.fields
                .filter((f) => !f.hidden.includes(mode) && isFieldVisible(f as any, values))
                .map((f) => renderField(f))
              }
            </TabsContent>
          ))}
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
          return !(item as FieldMeta).hidden.includes(mode)
        })
        .map((item, i) => renderSchemaItem(item, i))
      }
    </>
  )
}
