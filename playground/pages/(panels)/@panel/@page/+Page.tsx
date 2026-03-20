'use client'

import { useState, useEffect } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { Breadcrumbs }       from '../../_components/Breadcrumbs.js'
import { SchemaElementRenderer }    from '../../_components/SchemaElementRenderer.js'
import { DashboardGrid }     from '../../_components/DashboardGrid.js'
import { StandaloneWidget }  from '../../_components/StandaloneWidget.js'
import { FormElement }       from '../../_components/FormElement.js'
import { DialogElement }     from '../../_components/DialogElement.js'
import type { PanelSchemaElementMeta, PanelI18n, FormElementMeta, DialogElementMeta, WidgetMeta } from '@boostkit/panels'
import type { WidgetWithData } from '../../_components/WidgetCard.js'
import type { DashboardGridProps } from '../../_components/DashboardGrid.js'
import type { Data } from './+data.js'

type DashboardLayoutItem = DashboardGridProps['ssrLayout'] extends (infer T)[] | undefined ? T : never

interface TabItem { label: string; elements?: SchemaElement[]; icon?: string; lazy?: boolean; badge?: string | number | null; [key: string]: unknown }

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
}

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
                {group.items.map((el, wi: number) => {
                  const widgetEl = el as { type: 'widget'; id?: string; defaultSize?: { w: number; h: number } }
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

          // Schema-level Section
          if (el.type === 'section') {
            const sectionEl = el as { type: 'section'; title: string; description?: string; collapsible: boolean; collapsed: boolean; columns: number; elements?: SchemaElement[] }
            if (sectionEl.elements?.length) {
              return <SchemaSection key={`s-${gi}`} section={sectionEl} panelPath={panelMeta.path} pathSegment={pathSegment} i18n={i18n} urlSearch={urlSearch} />
            }
          }

          // Schema-level Tabs
          if (el.type === 'tabs') {
            const tabsEl = el as { type: 'tabs'; id?: string; tabs: TabItem[]; modelBacked?: boolean; persist?: 'localStorage' | 'url' | 'session' | false; activeTab?: number }
            const isModelBacked = !!tabsEl.modelBacked
            if (isModelBacked || tabsEl.tabs?.some((t: TabItem) => (t.elements?.length ?? 0) > 0)) {
              return <SchemaTabs key={`t-${gi}`} id={tabsEl.id} tabs={tabsEl.tabs} urlSearch={urlSearch} panelPath={panelMeta.path} pathSegment={pathSegment} i18n={i18n} modelBacked={isModelBacked} persist={tabsEl.persist} activeTab={tabsEl.activeTab} />
            }
          }

          // Dashboard
          if (el.type === 'dashboard') {
            const dashEl = el as DashboardEl
            return <DashboardSection key={`d-${dashEl.id ?? gi}`} dashboard={dashEl} pathSegment={pathSegment} panelPath={panelMeta.path} i18n={i18n} />
          }

          // Form
          if (el.type === 'form') {
            return <FormElement key={`f-${(el as { id?: string }).id ?? gi}`} form={el as FormElementMeta} panelPath={panelMeta.path} i18n={i18n} />
          }

          // Dialog
          if (el.type === 'dialog') {
            return <DialogElement key={`dl-${(el as { id?: string }).id ?? gi}`} dialog={el as DialogElementMeta} panelPath={panelMeta.path} i18n={i18n} />
          }

          return <SchemaElementRenderer key={gi} element={el as PanelSchemaElementMeta} panelPath={panelMeta.path} i18n={i18n} />
        })}
      </div>
    </>
  )
}

// ── Reusable components (same as panel root) ────────────────

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

interface SchemaSectionProps {
  section: { title: string; description?: string; collapsible: boolean; collapsed: boolean; columns: number; elements?: SchemaElement[] }
  panelPath: string
  pathSegment: string
  i18n: PanelI18n & Record<string, string>
  urlSearch?: Record<string, string>
}

function SchemaSection({ section, panelPath, pathSegment, i18n, urlSearch }: SchemaSectionProps) {
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
      {open && section.elements?.length && (
        <div className="p-5 flex flex-col gap-4">
          {section.elements.map((el: SchemaElement, i: number) => {
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
                />
              )
            }
            if (el.type === 'form') {
              return <FormElement key={`sf-${(el as { id?: string }).id ?? i}`} form={el as FormElementMeta} panelPath={panelPath} i18n={i18n} />
            }
            if (el.type === 'dialog') {
              return <DialogElement key={`sd-${(el as { id?: string }).id ?? i}`} dialog={el as DialogElementMeta} panelPath={panelPath} i18n={i18n} />
            }
            if (el.type === 'section') {
              return <SchemaSection key={`ss-${i}`} section={el as SchemaSectionProps['section']} panelPath={panelPath} pathSegment={pathSegment} i18n={i18n} urlSearch={urlSearch} />
            }
            return <SchemaElementRenderer key={i} element={el as PanelSchemaElementMeta} panelPath={panelPath} i18n={i18n} />
          })}
        </div>
      )}
    </div>
  )
}

interface SchemaTabsProps {
  id?: string | undefined
  tabs: TabItem[]
  urlSearch?: Record<string, string> | undefined
  panelPath: string
  pathSegment: string
  i18n: PanelI18n & Record<string, string>
  modelBacked?: boolean
  persist?: 'localStorage' | 'url' | 'session' | false
  activeTab?: number
}

function SchemaTabs({ id, tabs, urlSearch, panelPath, pathSegment, i18n, modelBacked, persist, activeTab: ssrActiveTab }: SchemaTabsProps) {
  const tabsId = id
  const defaultSlug = slugify(tabs[0]?.label ?? '')

  // Determine initial active slug based on persist mode
  const [activeSlug, setActiveSlug] = useState<string>(() => {
    // SSR-resolved active tab takes priority (for url/session modes)
    if (ssrActiveTab !== undefined && ssrActiveTab > 0 && tabs[ssrActiveTab]) {
      return slugify(tabs[ssrActiveTab]!.label)
    }
    // URL mode — read from urlSearch
    if (persist === 'url' && id && urlSearch?.[id]) {
      return urlSearch[id]!
    }
    // localStorage — read on client only
    if (persist === 'localStorage' && id && typeof window !== 'undefined') {
      const stored = localStorage.getItem(`tabs:${id}`)
      if (stored) return stored
    }
    return defaultSlug
  })
  const [fetchedElements, setFetchedElements] = useState<Record<number, SchemaElement[]>>({})
  const [loading, setLoading] = useState(false)
  const activeIdx = Math.max(0, tabs.findIndex((t: TabItem) => slugify(t.label) === activeSlug))

  // Fetch content for the restored tab if it wasn't SSR'd (localStorage/session restore)
  useEffect(() => {
    if (activeIdx === 0) return
    const tab = tabs[activeIdx]
    if (!tab || tab.elements?.length || fetchedElements[activeIdx]) return
    if (!tabsId) return

    const tabParam = modelBacked
      ? (tab as Record<string, unknown>).id as string | undefined
      : slugify(tab.label)
    if (!tabParam) return

    setLoading(true)
    fetch(`/${pathSegment}/api/_tabs/${tabsId}?tab=${tabParam}`)
      .then(r => r.ok ? r.json() : null)
      .then((body: { tab?: { elements?: SchemaElement[] } } | null) => {
        if (body?.tab?.elements) {
          setFetchedElements(prev => ({ ...prev, [activeIdx]: body.tab!.elements! }))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function switchTab(label: string) {
    const slug = slugify(label)
    setActiveSlug(slug)

    // Persist active tab based on mode
    if (persist === 'url' && typeof window !== 'undefined' && id) {
      const url = new URL(window.location.href)
      if (slug === slugify(tabs[0]?.label ?? '')) {
        url.searchParams.delete(id)
      } else {
        url.searchParams.set(id, slug)
      }
      window.history.replaceState(null, '', url.pathname + url.search)
    } else if (persist === 'localStorage' && id && typeof window !== 'undefined') {
      localStorage.setItem(`tabs:${id}`, slug)
    } else if (persist === 'session' && id) {
      fetch(`/${pathSegment}/api/_tabs/${id}/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab: slug }),
      }).catch(() => {})  // fire-and-forget
    }

    // Fetch content for tabs that don't have elements yet (model-backed or static)
    const idx = Math.max(0, tabs.findIndex(t => slugify(t.label) === slug))
    const tab = tabs[idx]
    if (tab && !tab.elements?.length && !fetchedElements[idx] && tabsId) {
      // Model-backed uses record ID, static uses slugified label
      const tabParam = modelBacked
        ? (tab as Record<string, unknown>).id as string | undefined
        : slugify(tab.label)
      if (tabParam) {
        try {
          setLoading(true)
          const res = await fetch(`/${pathSegment}/api/_tabs/${tabsId}?tab=${tabParam}`)
          if (res.ok) {
            const body = await res.json() as { tab?: { elements?: SchemaElement[] } }
            if (body.tab?.elements) {
              setFetchedElements(prev => ({ ...prev, [idx]: body.tab!.elements! }))
            }
          }
        } catch { /* fetch failed */ }
        finally { setLoading(false) }
      }
    }
  }

  const activeElements = tabs[activeIdx]?.elements?.length
    ? tabs[activeIdx]!.elements!
    : fetchedElements[activeIdx] ?? []

  return (
    <div>
      <div className="flex items-center gap-1 mb-4">
        {tabs.map((tab: TabItem, idx: number) => (
          <button key={idx} type="button" onClick={() => void switchTab(tab.label)}
            className={`inline-flex items-center px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeIdx === idx ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >{tab.label}{tab.badge != null && <span className={`ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium ${activeIdx === idx ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{tab.badge}</span>}</button>
        ))}
      </div>
      {loading && activeElements.length === 0 && (
        <div className="space-y-4">
          <div className="h-32 rounded-xl bg-muted/30 animate-pulse" />
          <div className="h-24 rounded-xl bg-muted/30 animate-pulse" />
        </div>
      )}
      <div className="flex flex-col gap-6">
        {activeElements.map((el: SchemaElement, i: number) => (
          <SchemaElementRenderer key={i} element={el as PanelSchemaElementMeta} panelPath={panelPath} i18n={i18n} />
        ))}
      </div>
    </div>
  )
}

interface DashboardTabItem { id: string; label: string; widgets: unknown[]; [key: string]: unknown }

interface DashboardSectionProps {
  dashboard: DashboardEl
  pathSegment: string
  panelPath: string
  i18n: PanelI18n & Record<string, string>
}

function DashboardSection({ dashboard, pathSegment, panelPath, i18n }: DashboardSectionProps) {
  const tabs = dashboard.tabs as DashboardTabItem[] | undefined
  const hasTabs = (tabs?.length ?? 0) > 0
  const hasTopWidgets = (dashboard.widgets?.length ?? 0) > 0
  const [activeTab, setActiveTab] = useState(tabs?.[0]?.id ?? null)

  const widgets    = dashboard.widgets as WidgetMeta[]
  const ssrWidgets = dashboard.widgets as WidgetWithData[]
  const ssrLayout  = dashboard.savedLayout as DashboardLayoutItem[] | undefined

  return (
    <div className="space-y-4">
      {hasTopWidgets && (
        <DashboardGrid dashboardId={dashboard.id} label={dashboard.label} editable={dashboard.editable}
          defaultWidgets={widgets} ssrWidgets={ssrWidgets} ssrLayout={ssrLayout}
          pathSegment={pathSegment} panelPath={panelPath} i18n={i18n} />
      )}
      {hasTabs && (
        <div>
          <div className="flex gap-1 border-b mb-4">
            {(tabs ?? []).map((tab: DashboardTabItem) => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >{tab.label}</button>
            ))}
          </div>
          {(tabs ?? []).map((tab: DashboardTabItem) => {
            const tabWidgets    = tab.widgets as WidgetMeta[]
            const tabSsrWidgets = tab.widgets as WidgetWithData[]
            const tabSsrLayout  = dashboard.savedTabLayouts?.[tab.id] as DashboardLayoutItem[] | undefined
            return activeTab === tab.id && (
              <DashboardGrid key={tab.id} dashboardId={dashboard.id} tabId={tab.id} editable={dashboard.editable}
                defaultWidgets={tabWidgets} ssrWidgets={tabSsrWidgets} ssrLayout={tabSsrLayout}
                pathSegment={pathSegment} panelPath={panelPath} i18n={i18n} />
            )
          })}
        </div>
      )}
    </div>
  )
}
