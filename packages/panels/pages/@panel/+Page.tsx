/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { WidgetRenderer } from '../_components/WidgetRenderer.js'
import { DashboardGrid }  from '../_components/DashboardGrid.js'
import { StandaloneWidget } from '../_components/StandaloneWidget.js'
import { FormElement }   from '../_components/FormElement.js'
import { DialogElement } from '../_components/DialogElement.js'
import type { PanelI18n } from '@boostkit/panels'
import type { Data } from './+data.js'

export default function PanelRootPage() {
  const config = useConfig()
  const { panelMeta, schemaData, urlSearch } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  config({ title: panelName })

  const i18n = panelMeta.i18n as PanelI18n & Record<string, string>
  const pathSegment = panelMeta.path.replace(/^\//, '')

  if (!schemaData || schemaData.length === 0) return null

  // Group consecutive standalone widgets into grid rows
  const groups: { type: 'widget-group' | 'element'; items: any[] }[] = []
  for (const el of schemaData) {
    if ((el as any).type === 'widget') {
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
              {group.items.map((el: any, wi: number) => {
                const w = el.defaultSize?.w ?? 12
                return (
                  <div key={`widget-${el.id ?? wi}`} style={{ gridColumn: `span ${Math.min(w, 12)}` }}>
                    <StandaloneWidget
                      widget={el}
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

        // Schema-level Section (collapsible card with schema elements inside)
        if (el.type === 'section' && el.elements?.length > 0) {
          return (
            <SchemaSection
              key={`section-${gi}`}
              section={el}
              panelPath={panelMeta.path}
              pathSegment={pathSegment}
              i18n={i18n}
            />
          )
        }

        // Schema-level Tabs
        if (el.type === 'tabs' && el.tabs?.some((t: any) => t.elements?.length > 0)) {
          return (
            <SchemaTabs
              key={`tabs-${gi}`}
              id={(el as any).id}
              tabs={el.tabs}
              urlSearch={urlSearch}
              panelPath={panelMeta.path}
              pathSegment={pathSegment}
              i18n={i18n}
            />
          )
        }

        if (el.type === 'form') {
          return (
            <FormElement
              key={`form-${el.id ?? gi}`}
              form={el}
              panelPath={panelMeta.path}
              i18n={i18n}
            />
          )
        }

        if (el.type === 'dialog') {
          return (
            <DialogElement
              key={`dialog-${el.id ?? gi}`}
              dialog={el}
              panelPath={panelMeta.path}
              pathSegment={pathSegment}
              i18n={i18n}
            />
          )
        }

        if (el.type === 'dashboard') {
          return (
            <DashboardSection
              key={`dash-${el.id ?? gi}`}
              dashboard={el}
              pathSegment={pathSegment}
              panelPath={panelMeta.path}
              i18n={i18n}
            />
          )
        }
        return (
          <WidgetRenderer key={gi} element={el} panelPath={panelMeta.path} i18n={i18n} />
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
            {(dashboard.tabs ?? []).map(tab => (
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
          {(dashboard.tabs ?? []).map(tab => (
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

// ── Schema-level Tabs ────────────────────────────────────────────

interface SchemaTabsProps {
  id?: string
  tabs: { label: string; elements?: any[] }[]
  urlSearch?: Record<string, string>
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
        {(tabs[activeIdx]?.elements ?? []).map((el: any, i: number) => {
          if (el.type === 'widget') {
            return (
              <StandaloneWidget
                key={`${activeIdx}-tw-${i}`}
                widget={el}
                panelPath={panelPath}
                pathSegment={pathSegment}
                i18n={i18n}
              />
            )
          }
          if (el.type === 'form') {
            return (
              <FormElement key={`${activeIdx}-tf-${el.id ?? i}`} form={el} panelPath={panelPath} i18n={i18n} />
            )
          }
          if (el.type === 'dashboard') {
            return (
              <DashboardSection
                key={`${activeIdx}-td-${el.id ?? i}`}
                dashboard={el}
                pathSegment={pathSegment}
                panelPath={panelPath}
                i18n={i18n}
              />
            )
          }
          return (
            <WidgetRenderer key={`${activeIdx}-${i}`} element={el} panelPath={panelPath} i18n={i18n} />
          )
        })}
      </div>
    </div>
  )
}

// ── Schema-level Section ─────────────────────────────────────────

interface SchemaSectionProps {
  section: { title: string; description?: string; collapsible: boolean; collapsed: boolean; columns: number; elements?: any[] }
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
            {section.elements.map((el: any, i: number) => {
              if (el.type === 'widget') {
                return (
                  <StandaloneWidget
                    key={`sw-${i}`}
                    widget={el}
                    panelPath={panelPath}
                    pathSegment={pathSegment}
                    i18n={i18n}
                  />
                )
              }
              if (el.type === 'form') {
                return (
                  <FormElement key={`sf-${el.id ?? i}`} form={el} panelPath={panelPath} i18n={i18n} />
                )
              }
              return (
                <WidgetRenderer key={i} element={el} panelPath={panelPath} i18n={i18n} />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
