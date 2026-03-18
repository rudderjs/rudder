'use client'

import { useState } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { Breadcrumbs }       from '../../_components/Breadcrumbs.js'
import { WidgetRenderer }    from '../../_components/WidgetRenderer.js'
import { DashboardGrid }     from '../../_components/DashboardGrid.js'
import { StandaloneWidget }  from '../../_components/StandaloneWidget.js'
import type { PanelI18n }    from '@boostkit/panels'
import type { Data } from './+data.js'

export default function SchemaPage() {
  const config = useConfig()
  const { panelMeta, pageMeta, schemaData, pathSegment, urlSearch } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = panelMeta.i18n as PanelI18n & Record<string, string>
  config({ title: `${pageMeta.label} — ${panelName}` })

  if (!schemaData || schemaData.length === 0) {
    return (
      <>
        <Breadcrumbs crumbs={[
          { label: panelName, href: `/${pathSegment}` },
          { label: pageMeta.label },
        ]} />
        <p className="text-muted-foreground">No content defined for this page.</p>
      </>
    )
  }

  // Group consecutive standalone widgets into grid rows (same logic as panel root)
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
    <>
      <Breadcrumbs crumbs={[
        { label: panelName, href: `/${pathSegment}` },
        { label: pageMeta.label },
      ]} />

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

          // Schema-level Section
          if (el.type === 'section' && el.elements?.length > 0) {
            return <SchemaSection key={`s-${gi}`} section={el} panelPath={panelMeta.path} pathSegment={pathSegment} i18n={i18n} />
          }

          // Schema-level Tabs
          if (el.type === 'tabs' && el.tabs?.some((t: any) => t.elements?.length > 0)) {
            return <SchemaTabs key={`t-${gi}`} id={(el as any).id} tabs={el.tabs} urlSearch={urlSearch} panelPath={panelMeta.path} pathSegment={pathSegment} i18n={i18n} />
          }

          // Dashboard
          if (el.type === 'dashboard') {
            return <DashboardSection key={`d-${el.id ?? gi}`} dashboard={el} pathSegment={pathSegment} panelPath={panelMeta.path} i18n={i18n} />
          }

          return <WidgetRenderer key={gi} element={el} panelPath={panelMeta.path} i18n={i18n} />
        })}
      </div>
    </>
  )
}

// ── Reusable components (same as panel root) ────────────────

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function SchemaSection({ section, panelPath, pathSegment: _pathSegment, i18n }: any) {
  const [open, setOpen] = useState(!section.collapsed)
  return (
    <div className="rounded-xl border bg-card">
      <div
        className={`flex items-center justify-between px-5 py-3 ${section.collapsible ? 'cursor-pointer' : ''} ${section.elements?.length ? 'border-b' : ''}`}
        onClick={section.collapsible ? () => setOpen(!open) : undefined}
      >
        <div>
          <p className="text-sm font-semibold">{section.title}</p>
          {section.description && <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>}
        </div>
        {section.collapsible && (
          <svg className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
      {open && section.elements?.length > 0 && (
        <div className="p-5 flex flex-col gap-4">
          {section.elements.map((el: any, i: number) => (
            <WidgetRenderer key={i} element={el} panelPath={panelPath} i18n={i18n} />
          ))}
        </div>
      )}
    </div>
  )
}

function SchemaTabs({ id, tabs, urlSearch, panelPath, pathSegment: _pathSegment, i18n }: any) {
  const paramKey = id ?? 'tab'
  const defaultSlug = slugify(tabs[0]?.label ?? '')
  const initialSlug = urlSearch?.[paramKey] ?? defaultSlug
  const [activeSlug, setActiveSlug] = useState<string>(initialSlug)
  const activeIdx = Math.max(0, tabs.findIndex((t: any) => slugify(t.label) === activeSlug))

  function switchTab(label: string) {
    const slug = slugify(label)
    setActiveSlug(slug)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (slug === slugify(tabs[0]?.label ?? '')) url.searchParams.delete(paramKey)
      else url.searchParams.set(paramKey, slug)
      window.history.replaceState(null, '', url.pathname + url.search)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1 mb-4">
        {tabs.map((tab: any, idx: number) => (
          <button key={idx} type="button" onClick={() => switchTab(tab.label)}
            className={`inline-flex items-center px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeIdx === idx ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >{tab.label}</button>
        ))}
      </div>
      <div className="flex flex-col gap-6">
        {(tabs[activeIdx]?.elements ?? []).map((el: any, i: number) => (
          <WidgetRenderer key={i} element={el} panelPath={panelPath} i18n={i18n} />
        ))}
      </div>
    </div>
  )
}

function DashboardSection({ dashboard, pathSegment, panelPath, i18n }: any) {
  const hasTabs = dashboard.tabs?.length > 0
  const hasTopWidgets = dashboard.widgets?.length > 0
  const [activeTab, setActiveTab] = useState(dashboard.tabs?.[0]?.id ?? null)

  return (
    <div className="space-y-4">
      {hasTopWidgets && (
        <DashboardGrid dashboardId={dashboard.id} label={dashboard.label} editable={dashboard.editable}
          defaultWidgets={dashboard.widgets} ssrWidgets={dashboard.widgets} ssrLayout={dashboard.savedLayout}
          pathSegment={pathSegment} panelPath={panelPath} i18n={i18n} />
      )}
      {hasTabs && (
        <div>
          <div className="flex gap-1 border-b mb-4">
            {dashboard.tabs.map((tab: any) => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >{tab.label}</button>
            ))}
          </div>
          {dashboard.tabs.map((tab: any) => (
            activeTab === tab.id && (
              <DashboardGrid key={tab.id} dashboardId={dashboard.id} tabId={tab.id} editable={dashboard.editable}
                defaultWidgets={tab.widgets} ssrWidgets={tab.widgets} ssrLayout={dashboard.savedTabLayouts?.[tab.id]}
                pathSegment={pathSegment} panelPath={panelPath} i18n={i18n} />
            )
          ))}
        </div>
      )}
    </div>
  )
}
