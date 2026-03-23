'use client'

import { useState, useEffect } from 'react'
import { SchemaElementRenderer } from './SchemaElementRenderer.js'
import { StandaloneWidget } from './StandaloneWidget.js'
import { SchemaForm } from './SchemaForm.js'
import { SchemaDialog } from './SchemaDialog.js'
import type { PanelSchemaElementMeta, FormElementMeta, DialogElementMeta } from '@boostkit/panels'
import type { WidgetWithSchema } from './WidgetCard.js'
import { slugify } from '../_lib/persist.js'
import type { SchemaElement, TabItem, DashboardEl, I18nExtended } from './schema-types.js'

// Lazy import to avoid circular dependency — DashboardSection is only used inside tab content
let DashboardSectionComp: React.ComponentType<{ dashboard: DashboardEl; pathSegment: string; panelPath: string; i18n: I18nExtended }> | null = null

export interface SchemaTabsProps {
  id?: string | undefined
  tabs: TabItem[]
  urlSearch?: Record<string, string> | undefined
  panelPath: string
  pathSegment: string
  i18n: I18nExtended
  modelBacked?: boolean
  persist?: 'localStorage' | 'url' | 'session' | false
  activeTab?: number
  /** Optional render function for dashboard elements inside tabs */
  renderDashboard?: (el: DashboardEl, idx: number) => React.ReactNode
}

export function SchemaTabs({ id, tabs, urlSearch, panelPath, pathSegment, i18n, modelBacked, persist, activeTab: ssrActiveTab, renderDashboard }: SchemaTabsProps) {
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

  const activeIdx = Math.max(0, tabs.findIndex(t => slugify(t.label) === activeSlug))

  // Fetch content for the restored tab if it wasn't SSR'd (localStorage/session restore)
  useEffect(() => {
    if (activeIdx === 0) return  // first tab is always SSR'd
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
    if (persist && id) {
      if (persist === 'url') {
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href)
          if (slug === slugify(tabs[0]?.label ?? '')) {
            url.searchParams.delete(id)
          } else {
            url.searchParams.set(id, slug)
          }
          window.history.replaceState(null, '', url.pathname + url.search)
        }
      } else if (persist === 'localStorage') {
        if (typeof window !== 'undefined') {
          localStorage.setItem(`tabs:${id}`, slug)
        }
      } else if (persist === 'session') {
        fetch(`/${pathSegment}/api/_tabs/${id}/active`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab: slug }),
        }).catch(() => {})
      }
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
        {tabs.map((tab, idx) => {
          const isActive = idx === activeIdx
          return (
            <button
              key={idx}
              type="button"
              onClick={() => void switchTab(tab.label)}
              className={[
                'inline-flex items-center px-3 py-1.5 text-sm rounded-md transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              ].join(' ')}
            >
              {tab.label}
              {tab.badge != null && (
                <span className={`ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium ${isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{tab.badge}</span>
              )}
            </button>
          )
        })}
      </div>
      {loading && activeElements.length === 0 && (
        <div className="space-y-4">
          <div className="h-32 rounded-xl bg-muted/30 animate-pulse" />
          <div className="h-24 rounded-xl bg-muted/30 animate-pulse" />
        </div>
      )}
      {/* Render all tabs but hide inactive — prevents unmount/remount flash */}
      {tabs.map((tab, tabIdx) => {
        const tabElements = tab.elements?.length
          ? tab.elements
          : fetchedElements[tabIdx] ?? []
        const isActive = tabIdx === activeIdx
        return (
          <div key={tabIdx} className={isActive ? 'flex flex-col gap-6' : 'hidden'}>
            {tabElements.map((el: SchemaElement, i: number) => {
              if (el.type === 'widget') {
                return (
                  <StandaloneWidget
                    key={`${tabIdx}-tw-${i}`}
                    widget={el as unknown as WidgetWithSchema}
                    panelPath={panelPath}
                    pathSegment={pathSegment}
                    i18n={i18n}
                  />
                )
              }
              if (el.type === 'form') {
                return (
                  <SchemaForm key={`${tabIdx}-tf-${(el as { id?: string }).id ?? i}`} form={el as FormElementMeta} panelPath={panelPath} i18n={i18n} />
                )
              }
              if (el.type === 'dialog') {
                return (
                  <SchemaDialog key={`${tabIdx}-td-${(el as { id?: string }).id ?? i}`} dialog={el as DialogElementMeta} panelPath={panelPath} pathSegment={pathSegment} i18n={i18n} />
                )
              }
              if (el.type === 'dashboard' && renderDashboard) {
                return renderDashboard(el as DashboardEl, i)
              }
              return (
                <SchemaElementRenderer key={`${tabIdx}-${i}`} element={el as PanelSchemaElementMeta} panelPath={panelPath} i18n={i18n} />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
