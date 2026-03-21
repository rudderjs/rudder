'use client'

import { useState } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { SchemaElementRenderer } from '../_components/SchemaElementRenderer.js'
import { DashboardGrid }  from '../_components/DashboardGrid.js'
import { StandaloneWidget } from '../_components/StandaloneWidget.js'
import { FormElement }   from '../_components/FormElement.js'
import { DialogElement } from '../_components/DialogElement.js'
import { SchemaTabs } from '../_components/SchemaTabs.js'
import { SchemaSection } from '../_components/SchemaSection.js'
import type { PanelSchemaElementMeta, PanelI18n, FormElementMeta, DialogElementMeta, WidgetMeta } from '@boostkit/panels'
import type { WidgetWithData } from '../_components/WidgetCard.js'
import type { DashboardGridProps } from '../_components/DashboardGrid.js'
import type { Data } from './+data.js'
import { slugify } from '../_lib/persist.js'
import type { SchemaElement, TabItem, DashboardEl, DashboardTabItem, DashboardLayoutItem, I18nExtended } from '../_components/schema-types.js'

export default function PanelRootPage() {
  const config = useConfig()
  const { panelMeta, schemaData, urlSearch } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  config({ title: panelName })

  const i18n = panelMeta.i18n as I18nExtended
  const pathSegment = panelMeta.path.replace(/^\//, '')

  if (!schemaData || schemaData.length === 0) return null

  // Group consecutive standalone widgets into grid rows
  const groups: { type: 'widget-group' | 'element'; items: SchemaElement[] }[] = []
  for (const el of schemaData as SchemaElement[]) {
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
        panelPath={panelMeta.path}
        i18n={i18n}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
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
                      widget={el as unknown as WidgetWithData}
                      panelPath={panelMeta.path}
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
                panelPath={panelMeta.path}
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
                panelPath={panelMeta.path}
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
            <FormElement
              key={`form-${(el as { id?: string }).id ?? gi}`}
              form={el as FormElementMeta}
              panelPath={panelMeta.path}
              i18n={i18n}
            />
          )
        }

        if (el.type === 'dialog') {
          return (
            <DialogElement
              key={`dialog-${(el as { id?: string }).id ?? gi}`}
              dialog={el as DialogElementMeta}
              panelPath={panelMeta.path}
              pathSegment={pathSegment}
              i18n={i18n}
            />
          )
        }

        if (el.type === 'dashboard') {
          const dashEl = el as DashboardEl
          return (
            <DashboardSection
              key={`dash-${dashEl.id ?? gi}`}
              dashboard={dashEl}
              pathSegment={pathSegment}
              panelPath={panelMeta.path}
              i18n={i18n}
            />
          )
        }
        return (
          <SchemaElementRenderer key={gi} element={el as PanelSchemaElementMeta} panelPath={panelMeta.path} i18n={i18n} />
        )
      })}
    </div>
  )
}

// ── Dashboard section — handles top-level widgets + optional tabs ──

interface DashboardSectionProps {
  dashboard: DashboardEl
  pathSegment: string
  panelPath: string
  i18n: I18nExtended
}

function DashboardSection({ dashboard, pathSegment, panelPath, i18n }: DashboardSectionProps) {
  const tabs = dashboard.tabs as DashboardTabItem[] | undefined
  const hasTabs = tabs && tabs.length > 0
  const hasTopWidgets = (dashboard.widgets?.length ?? 0) > 0
  const [activeTab, setActiveTab] = useState(tabs?.[0]?.id ?? null)

  const widgets      = dashboard.widgets as WidgetMeta[]
  const ssrWidgets   = dashboard.widgets as WidgetWithData[]
  const ssrLayout    = dashboard.savedLayout as DashboardLayoutItem[] | undefined

  return (
    <div className="space-y-4">
      {/* Top-level widgets grid */}
      {hasTopWidgets && (
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
      )}

      {/* Tabs */}
      {hasTabs && (
        <div>
          {/* Tab bar */}
          <div className="flex gap-1 border-b mb-4">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Active tab's grid */}
          {tabs.map(tab => {
            const tabWidgets    = tab.widgets as WidgetMeta[]
            const tabSsrWidgets = tab.widgets as WidgetWithData[]
            const tabSsrLayout  = dashboard.savedTabLayouts?.[tab.id] as DashboardLayoutItem[] | undefined
            return activeTab === tab.id && (
              <DashboardGrid
                key={tab.id}
                dashboardId={dashboard.id}
                tabId={tab.id}
                editable={dashboard.editable}
                defaultWidgets={tabWidgets}
                ssrWidgets={tabSsrWidgets}
                ssrLayout={tabSsrLayout}
                pathSegment={pathSegment}
                panelPath={panelPath}
                i18n={i18n}
              />
            )
          })}
        </div>
      )}

      {/* If only label, no widgets, no tabs — show empty label header via DashboardGrid */}
      {!hasTopWidgets && !hasTabs && dashboard.label && (
        <DashboardGrid
          dashboardId={dashboard.id}
          label={dashboard.label}
          editable={dashboard.editable}
          defaultWidgets={[]}
          pathSegment={pathSegment}
          panelPath={panelPath}
          i18n={i18n}
        />
      )}
    </div>
  )
}
