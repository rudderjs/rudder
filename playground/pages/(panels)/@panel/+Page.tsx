'use client'

import { useState } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { WidgetRenderer } from '../_components/WidgetRenderer.js'
import { DashboardGrid }  from '../_components/DashboardGrid.js'
import { StandaloneWidget } from '../_components/StandaloneWidget.js'
import { FormElement }   from '../_components/FormElement.js'
import { DialogElement } from '../_components/DialogElement.js'
import type { PanelSchemaElementMeta, PanelI18n, FormElementMeta, DialogElementMeta, WidgetMeta } from '@boostkit/panels'
import type { WidgetWithData } from '../_components/WidgetCard.js'
import type { DashboardGridProps } from '../_components/DashboardGrid.js'
import type { Data } from './+data.js'

// Runtime schema elements include types beyond PanelSchemaElementMeta (widget, dashboard, section, tabs).
// These extra types are pushed via `as unknown as PanelSchemaElementMeta` in resolveSchema.
type DashboardLayoutItem = DashboardGridProps['ssrLayout'] extends (infer T)[] | undefined ? T : never
interface TabItem { label: string; elements?: SchemaElement[]; [key: string]: unknown }

type DashboardEl = {
  type: 'dashboard'; id: string; label?: string; editable: boolean
  widgets: unknown[]; tabs?: unknown[]; savedLayout?: unknown[]; savedTabLayouts?: Record<string, unknown[]>
}

type SchemaElement = PanelSchemaElementMeta | {
  type: 'widget'; id?: string; defaultSize?: { w: number; h: number }; [key: string]: unknown
} | DashboardEl | {
  type: 'section'; title: string; description?: string; collapsible: boolean
  collapsed: boolean; columns: number; elements?: SchemaElement[]
} | {
  type: 'tabs'; id?: string; tabs: TabItem[]
} | {
  type: 'form'; id?: string; [key: string]: unknown
} | {
  type: 'dialog'; id?: string; [key: string]: unknown
}

export default function PanelRootPage() {
  const config = useConfig()
  const { panelMeta, schemaData, urlSearch } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  config({ title: panelName })

  const i18n = panelMeta.i18n as PanelI18n & Record<string, string>
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
              />
            )
          }
        }

        // Schema-level Tabs
        if (el.type === 'tabs') {
          const tabsEl = el as { type: 'tabs'; id?: string; tabs: TabItem[] }
          if (tabsEl.tabs?.some((t: TabItem) => (t.elements?.length ?? 0) > 0)) {
            return (
              <SchemaTabs
                key={`tabs-${gi}`}
                id={tabsEl.id}
                tabs={tabsEl.tabs}
                urlSearch={urlSearch}
                panelPath={panelMeta.path}
                pathSegment={pathSegment}
                i18n={i18n}
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
          <WidgetRenderer key={gi} element={el as PanelSchemaElementMeta} panelPath={panelMeta.path} i18n={i18n} />
        )
      })}
    </div>
  )
}

// ── Dashboard section — handles top-level widgets + optional tabs ──

interface DashboardTabItem { id: string; label: string; widgets: unknown[]; [key: string]: unknown }

interface DashboardSectionProps {
  dashboard: DashboardEl
  pathSegment: string
  panelPath: string
  i18n: PanelI18n & Record<string, string>
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

// ── Schema-level Tabs ────────────────────────────────────────────

interface SchemaTabsProps {
  id?: string | undefined
  tabs: TabItem[]
  urlSearch?: Record<string, string> | undefined
  panelPath: string
  pathSegment: string
  i18n: PanelI18n & Record<string, string>
}

/** Slugify a label for use as URL param value. */
function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function SchemaTabs({ id, tabs, urlSearch, panelPath, pathSegment, i18n }: SchemaTabsProps) {
  // URL query param key — named id or default 'tab'
  const paramKey = id ?? 'tab'
  const defaultSlug = slugify(tabs[0]?.label ?? '')

  // Read active tab from SSR-provided URL search (works on both server and client)
  const initialSlug = urlSearch?.[paramKey] ?? defaultSlug

  const [activeSlug, setActiveSlug] = useState<string>(initialSlug)

  const activeIdx = Math.max(0, tabs.findIndex(t => slugify(t.label) === activeSlug))

  function switchTab(label: string) {
    const slug = slugify(label)
    setActiveSlug(slug)

    // Update URL without navigation
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (slug === slugify(tabs[0]?.label ?? '')) {
        url.searchParams.delete(paramKey)
      } else {
        url.searchParams.set(paramKey, slug)
      }
      window.history.replaceState(null, '', url.pathname + url.search)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1 mb-4">
        {tabs.map((tab, idx) => {
          const isActive = idx === activeIdx
          return (
            <button
              key={idx}
              type="button"
              onClick={() => switchTab(tab.label)}
              className={[
                'inline-flex items-center px-3 py-1.5 text-sm rounded-md transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              ].join(' ')}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-6">
        {(tabs[activeIdx]?.elements ?? []).map((el: SchemaElement, i: number) => {
          if (el.type === 'widget') {
            return (
              <StandaloneWidget
                key={`${activeIdx}-tw-${i}`}
                widget={el as unknown as WidgetWithData}
                panelPath={panelPath}
                pathSegment={pathSegment}
                i18n={i18n}
              />
            )
          }
          if (el.type === 'form') {
            return (
              <FormElement key={`${activeIdx}-tf-${(el as { id?: string }).id ?? i}`} form={el as FormElementMeta} panelPath={panelPath} i18n={i18n} />
            )
          }
          if (el.type === 'dashboard') {
            const dashEl = el as DashboardEl
            return (
              <DashboardSection
                key={`${activeIdx}-td-${dashEl.id ?? i}`}
                dashboard={dashEl}
                pathSegment={pathSegment}
                panelPath={panelPath}
                i18n={i18n}
              />
            )
          }
          return (
            <WidgetRenderer key={`${activeIdx}-${i}`} element={el as PanelSchemaElementMeta} panelPath={panelPath} i18n={i18n} />
          )
        })}
      </div>
    </div>
  )
}

// ── Schema-level Section ─────────────────────────────────────────

interface SchemaSectionProps {
  section: { title: string; description?: string; collapsible: boolean; collapsed: boolean; columns: number; elements?: SchemaElement[] }
  panelPath: string
  pathSegment: string
  i18n: PanelI18n & Record<string, string>
}

function SchemaSection({ section, panelPath, pathSegment, i18n }: SchemaSectionProps) {
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
                  <FormElement key={`sf-${(el as { id?: string }).id ?? i}`} form={el as FormElementMeta} panelPath={panelPath} i18n={i18n} />
                )
              }
              return (
                <WidgetRenderer key={i} element={el as PanelSchemaElementMeta} panelPath={panelPath} i18n={i18n} />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
