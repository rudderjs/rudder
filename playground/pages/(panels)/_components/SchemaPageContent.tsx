'use client'

import { SchemaElementRenderer } from './SchemaElementRenderer.js'
import { DashboardGrid }  from './DashboardGrid.js'
import { StandaloneWidget } from './StandaloneWidget.js'
import { SchemaForm }   from './SchemaForm.js'
import { SchemaDialog } from './SchemaDialog.js'
import { SchemaTabs } from './SchemaTabs.js'
import { SchemaSection } from './SchemaSection.js'
import type { PanelSchemaElementMeta, FormElementMeta, DialogElementMeta, WidgetMeta } from '@boostkit/panels'
import type { WidgetWithSchema } from './WidgetCard.js'
import type { SchemaElement, TabItem, DashboardEl, DashboardLayoutItem, I18nExtended } from './schema-types.js'

// ── Dashboard section — handles top-level dashboard widgets ──

interface DashboardSectionProps {
  dashboard: DashboardEl
  pathSegment: string
  panelPath: string
  i18n: I18nExtended
}

function DashboardSection({ dashboard, pathSegment, panelPath, i18n }: DashboardSectionProps) {
  const widgets    = dashboard.widgets as WidgetMeta[]
  const ssrWidgets = dashboard.widgets as WidgetWithSchema[]
  const ssrLayout  = dashboard.savedLayout as DashboardLayoutItem[] | undefined

  return (
    <DashboardGrid
      dashboardId={dashboard.id}
      label={dashboard.label}
      editable={dashboard.editable}
      defaultWidgets={widgets}
      ssrWidgets={ssrWidgets}
      ssrLayout={ssrLayout}
      pathSegment={pathSegment}
      panelPath={panelPath}
      i18n={i18n}
    />
  )
}

// ── SchemaPageContent — shared layout for panel root and schema pages ──

export interface SchemaPageContentProps {
  elements: SchemaElement[]
  panelPath: string
  pathSegment: string
  i18n: I18nExtended
  urlSearch?: Record<string, string>
}

export function SchemaPageContent({ elements, panelPath, pathSegment, i18n, urlSearch }: SchemaPageContentProps) {
  if (!elements || elements.length === 0) return null

  // Group consecutive standalone widgets into grid rows
  const groups: { type: 'widget-group' | 'element'; items: SchemaElement[] }[] = []
  for (const el of elements) {
    if (el.type === 'widget') {
      const last = groups[groups.length - 1]
      if (last?.type === 'widget-group') {
        last.items.push(el)
      } else {
        groups.push({ type: 'widget-group', items: [el] })
      }
    } else {
      groups.push({ type: 'element', items: [el] })
    }
  }

  function renderDashboard(el: DashboardEl, idx: number) {
    return (
      <DashboardSection
        key={`dash-${el.id ?? idx}`}
        dashboard={el}
        pathSegment={pathSegment}
        panelPath={panelPath}
        i18n={i18n}
      />
    )
  }

  return (
    <>
      {groups.map((group, gi) => {
        if (group.type === 'widget-group') {
          return (
            <div key={`wg-${gi}`} className="grid grid-cols-12 gap-4">
              {group.items.map((el, wi: number) => {
                const widgetEl = el as { type: 'widget'; id?: string; defaultSize?: { w: number; h: number }; [key: string]: unknown }
                const w = widgetEl.defaultSize?.w ?? 12
                return (
                  <div key={`widget-${widgetEl.id ?? wi}`} style={{ gridColumn: `span ${Math.min(w, 12)}` }}>
                    <StandaloneWidget
                      widget={el as unknown as WidgetWithSchema}
                      panelPath={panelPath}
                      pathSegment={pathSegment}
                      i18n={i18n}
                    />
                  </div>
                )
              })}
            </div>
          )
        }

        const el = group.items[0]
        if (!el) return null

        // Schema-level Section (collapsible card with schema elements inside)
        if (el.type === 'section') {
          const sectionEl = el as { type: 'section'; title: string; description?: string; collapsible: boolean; collapsed: boolean; columns: number; elements?: SchemaElement[] }
          if (sectionEl.elements?.length) {
            return (
              <SchemaSection
                key={`section-${gi}`}
                section={sectionEl}
                panelPath={panelPath}
                pathSegment={pathSegment}
                i18n={i18n}
                urlSearch={urlSearch}
                renderDashboard={renderDashboard}
              />
            )
          }
        }

        // Schema-level Tabs
        if (el.type === 'tabs') {
          const tabsEl = el as { type: 'tabs'; id?: string; tabs: TabItem[]; modelBacked?: boolean; persist?: 'localStorage' | 'url' | 'session' | false; activeTab?: number }
          const isModelBacked = !!tabsEl.modelBacked
          if (isModelBacked || tabsEl.tabs?.some((t: TabItem) => (t.elements?.length ?? 0) > 0)) {
            return (
              <SchemaTabs
                key={`tabs-${gi}`}
                id={tabsEl.id}
                tabs={tabsEl.tabs}
                urlSearch={urlSearch}
                panelPath={panelPath}
                pathSegment={pathSegment}
                i18n={i18n}
                modelBacked={isModelBacked}
                persist={tabsEl.persist}
                activeTab={tabsEl.activeTab}
                renderDashboard={renderDashboard}
              />
            )
          }
        }

        if (el.type === 'form') {
          return (
            <SchemaForm
              key={`form-${(el as { id?: string }).id ?? gi}`}
              form={el as FormElementMeta}
              panelPath={panelPath}
              i18n={i18n}
            />
          )
        }

        if (el.type === 'dialog') {
          return (
            <SchemaDialog
              key={`dialog-${(el as { id?: string }).id ?? gi}`}
              dialog={el as DialogElementMeta}
              panelPath={panelPath}
              pathSegment={pathSegment}
              i18n={i18n}
            />
          )
        }

        if (el.type === 'dashboard') {
          const dashEl = el as DashboardEl
          return renderDashboard(dashEl, gi)
        }

        return (
          <SchemaElementRenderer key={gi} element={el as PanelSchemaElementMeta} panelPath={panelPath} i18n={i18n} />
        )
      })}
    </>
  )
}
