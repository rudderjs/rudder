'use client'

import { useState } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { WidgetRenderer } from '../_components/WidgetRenderer.js'
import { DashboardGrid }  from '../_components/DashboardGrid.js'
import { StandaloneWidget } from '../_components/StandaloneWidget.js'
import type { PanelI18n } from '@boostkit/panels'
import type { Data } from './+data.js'

export default function PanelRootPage() {
  const config = useConfig()
  const { panelMeta, schemaData } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  config({ title: panelName })

  const i18n = panelMeta.i18n as PanelI18n & Record<string, string>
  const pathSegment = panelMeta.path.replace(/^\//, '')

  if (!schemaData || schemaData.length === 0) return null

  return (
    <div className="flex flex-col gap-6">
      {schemaData.map((el, i) => {
        // Standalone widget — static, no customization
        if (el.type === 'widget') {
          return (
            <StandaloneWidget
              key={`widget-${(el as any).id ?? i}`}
              widget={el as any}
              panelPath={panelMeta.path}
              pathSegment={pathSegment}
              i18n={i18n}
            />
          )
        }
        // Dashboard elements get special rendering with DashboardGrid
        if (el.type === 'dashboard') {
          return (
            <DashboardSection
              key={`dash-${(el as any).id ?? i}`}
              dashboard={el as any}
              pathSegment={pathSegment}
              panelPath={panelMeta.path}
              i18n={i18n}
            />
          )
        }
        return (
          <WidgetRenderer key={i} element={el} panelPath={panelMeta.path} i18n={i18n} />
        )
      })}
    </div>
  )
}

// ── Dashboard section — handles top-level widgets + optional tabs ──

interface DashboardSectionProps {
  dashboard: {
    id: string
    label?: string
    editable: boolean
    widgets: any[]
    tabs?: { id: string; label: string; widgets: any[] }[]
    savedLayout?: any[]
    savedTabLayouts?: Record<string, any[]>
  }
  pathSegment: string
  panelPath: string
  i18n: PanelI18n & Record<string, string>
}

function DashboardSection({ dashboard, pathSegment, panelPath, i18n }: DashboardSectionProps) {
  const hasTabs = dashboard.tabs && dashboard.tabs.length > 0
  const hasTopWidgets = dashboard.widgets.length > 0
  const [activeTab, setActiveTab] = useState(dashboard.tabs?.[0]?.id ?? null)

  return (
    <div className="space-y-4">
      {/* Top-level widgets grid */}
      {hasTopWidgets && (
        <DashboardGrid
          dashboardId={dashboard.id}
          label={dashboard.label}
          editable={dashboard.editable}
          defaultWidgets={dashboard.widgets}
          ssrWidgets={dashboard.widgets}
          ssrLayout={dashboard.savedLayout}
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
            {dashboard.tabs!.map(tab => (
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
          {dashboard.tabs!.map(tab => (
            activeTab === tab.id && (
              <DashboardGrid
                key={tab.id}
                dashboardId={dashboard.id}
                tabId={tab.id}
                editable={dashboard.editable}
                defaultWidgets={tab.widgets}
                ssrWidgets={tab.widgets}
                ssrLayout={dashboard.savedTabLayouts?.[tab.id]}
                pathSegment={pathSegment}
                panelPath={panelPath}
                i18n={i18n}
              />
            )
          ))}
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
