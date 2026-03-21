'use client'

import { useState } from 'react'
import { SchemaElementRenderer } from './SchemaElementRenderer.js'
import { StandaloneWidget } from './StandaloneWidget.js'
import { SchemaForm } from './SchemaForm.js'
import { SchemaDialog } from './SchemaDialog.js'
import { SchemaTabs } from './SchemaTabs.js'
import type { PanelSchemaElementMeta, FormElementMeta, DialogElementMeta } from '@boostkit/panels'
import type { WidgetWithData } from './WidgetCard.js'
import type { SchemaElement, TabItem, DashboardEl, I18nExtended } from './schema-types.js'

export interface SchemaSectionProps {
  section: { title: string; description?: string; collapsible: boolean; collapsed: boolean; columns: number; elements?: SchemaElement[] }
  panelPath: string
  pathSegment: string
  i18n: I18nExtended
  urlSearch?: Record<string, string>
  /** Optional render function for dashboard elements inside sections */
  renderDashboard?: (el: DashboardEl, idx: number) => React.ReactNode
}

export function SchemaSection({ section, panelPath, pathSegment, i18n, urlSearch, renderDashboard }: SchemaSectionProps) {
  const [open, setOpen] = useState(!section.collapsed)

  return (
    <div className="rounded-xl border bg-card">
      {/* Header */}
      <div
        className={`flex items-center justify-between px-5 py-3 ${section.collapsible ? 'cursor-pointer' : ''} ${section.elements?.length ? 'border-b' : ''}`}
        onClick={section.collapsible ? () => setOpen(!open) : undefined}
      >
        <div>
          <p className="text-sm font-semibold">{section.title}</p>
          {section.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
          )}
        </div>
        {section.collapsible && (
          <svg
            className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>

      {/* Content */}
      {open && section.elements && section.elements.length > 0 && (
        <div className="p-5">
          <div className={`flex flex-col gap-4 ${section.columns > 1 ? `grid grid-cols-${section.columns}` : ''}`}>
            {section.elements.map((el: SchemaElement, i: number) => {
              if (el.type === 'widget') {
                return (
                  <StandaloneWidget
                    key={`sw-${i}`}
                    widget={el as unknown as WidgetWithData}
                    panelPath={panelPath}
                    pathSegment={pathSegment}
                    i18n={i18n}
                  />
                )
              }
              if (el.type === 'form') {
                return (
                  <SchemaForm key={`sf-${(el as { id?: string }).id ?? i}`} form={el as FormElementMeta} panelPath={panelPath} i18n={i18n} />
                )
              }
              if (el.type === 'tabs') {
                const tabsEl = el as { type: 'tabs'; id?: string; tabs: TabItem[]; modelBacked?: boolean; persist?: 'localStorage' | 'url' | 'session' | false; activeTab?: number }
                return (
                  <SchemaTabs
                    key={`st-${tabsEl.id ?? i}`}
                    id={tabsEl.id}
                    tabs={tabsEl.tabs}
                    urlSearch={urlSearch}
                    panelPath={panelPath}
                    pathSegment={pathSegment}
                    i18n={i18n}
                    modelBacked={!!tabsEl.modelBacked}
                    persist={tabsEl.persist}
                    activeTab={tabsEl.activeTab}
                    renderDashboard={renderDashboard}
                  />
                )
              }
              if (el.type === 'dialog') {
                return (
                  <SchemaDialog key={`sd-${(el as { id?: string }).id ?? i}`} dialog={el as DialogElementMeta} panelPath={panelPath} pathSegment={pathSegment} i18n={i18n} />
                )
              }
              if (el.type === 'section') {
                return (
                  <SchemaSection
                    key={`ss-${i}`}
                    section={el as SchemaSectionProps['section']}
                    panelPath={panelPath}
                    pathSegment={pathSegment}
                    i18n={i18n}
                    urlSearch={urlSearch}
                    renderDashboard={renderDashboard}
                  />
                )
              }
              return (
                <SchemaElementRenderer key={i} element={el as PanelSchemaElementMeta} panelPath={panelPath} i18n={i18n} />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
