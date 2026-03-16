'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ResponsiveGridLayout,
  useContainerWidth,
} from 'react-grid-layout'
import type {
  Layout,
  LayoutItem as RGLLayoutItem,
  ResponsiveLayouts,
} from 'react-grid-layout'
import { WidgetRenderer } from './WidgetRenderer.js'
import { WidgetSettingsDrawer } from './WidgetSettingsDrawer.js'
import type { PanelSchemaElementMeta, PanelI18n } from '@boostkit/panels'
import type { WidgetMeta } from '@boostkit/dashboards'

import 'react-grid-layout/css/styles.css'

// ── Grid config ──────────────────────────────────────────────────────────────
const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }
const ROW_HEIGHT = 80

// ── Types ────────────────────────────────────────────────────────────────────
interface DashboardLayoutItem {
  widgetId: string
  x:        number
  y:        number
  w:        number
  h:        number
  settings?: Record<string, unknown>
}

interface WidgetWithData extends WidgetMeta {
  data: unknown
}

export interface DashboardGridProps {
  dashboardId:    string
  label?:         string
  editable?:      boolean
  defaultWidgets: WidgetMeta[]
  pathSegment:    string
  panelPath:      string
  i18n:           PanelI18n & Record<string, string>
  tabId?:         string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Compute layout positions from widget definitions using greedy row-fill. */
function computeDefaultLayout(widgets: WidgetMeta[]): DashboardLayoutItem[] {
  const items: DashboardLayoutItem[] = []
  let curX = 0, curY = 0, rowMaxH = 0
  for (const w of widgets) {
    const size = w.defaultSize
    if (curX + size.w > 12) {
      curX = 0
      curY += rowMaxH
      rowMaxH = 0
    }
    items.push({ widgetId: w.id, x: curX, y: curY, w: size.w, h: size.h })
    curX += size.w
    rowMaxH = Math.max(rowMaxH, size.h)
  }
  return items
}

/** Build query string suffix for optional tabId. */
function tabQuery(tabId?: string): string {
  return tabId ? `?tab=${tabId}` : ''
}

// ── Component ────────────────────────────────────────────────────────────────

export function DashboardGrid({
  dashboardId,
  label,
  editable = true,
  defaultWidgets,
  pathSegment,
  panelPath,
  i18n,
  tabId,
}: DashboardGridProps) {
  const [widgets, setWidgets] = useState<WidgetWithData[]>([])
  const [layout, setLayout] = useState<DashboardLayoutItem[]>([])
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showPalette, setShowPalette] = useState(false)
  const [settingsWidgetId, setSettingsWidgetId] = useState<string | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // react-grid-layout v2: useContainerWidth hook replaces WidthProvider
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1200 })

  // -- Load widgets + layout --------------------------------------------------
  useEffect(() => {
    async function load() {
      try {
        const base = `/${pathSegment}/api/_dashboard/${dashboardId}`
        const qs = tabQuery(tabId)
        const [widgetsRes, layoutRes] = await Promise.all([
          fetch(`${base}/widgets${qs}`),
          fetch(`${base}/layout${qs}`),
        ])
        if (widgetsRes.ok) {
          const body = await widgetsRes.json() as { widgets: WidgetWithData[] }
          setWidgets(body.widgets)
        }
        if (layoutRes.ok) {
          const body = await layoutRes.json() as { layout: DashboardLayoutItem[] }
          if (body.layout.length > 0) {
            setLayout(body.layout)
          } else {
            // No saved layout — compute from defaults
            setLayout(computeDefaultLayout(defaultWidgets))
          }
        } else {
          // No layout endpoint or error — use defaults
          setLayout(computeDefaultLayout(defaultWidgets))
        }
      } catch {
        // Network error — fall back to defaults
        setLayout(computeDefaultLayout(defaultWidgets))
      }
      setLoading(false)
    }
    void load()
  }, [pathSegment, dashboardId, tabId]) // eslint-disable-line react-hooks/exhaustive-deps

  // -- Save layout ------------------------------------------------------------
  const saveLayout = useCallback(async (newLayout: DashboardLayoutItem[]) => {
    try {
      const base = `/${pathSegment}/api/_dashboard/${dashboardId}`
      const qs = tabQuery(tabId)
      await fetch(`${base}/layout${qs}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: newLayout }),
      })
    } catch { /* save failed silently */ }
  }, [pathSegment, dashboardId, tabId])

  // -- react-grid-layout change handler ---------------------------------------
  const handleLayoutChange = useCallback((rglLayout: Layout, _layouts: ResponsiveLayouts) => {
    if (!editing) return
    setLayout(prev => {
      return prev.map(item => {
        const rglItem = rglLayout.find((l: RGLLayoutItem) => l.i === item.widgetId)
        if (!rglItem) return item
        return {
          ...item,
          x: rglItem.x,
          y: rglItem.y,
          w: rglItem.w,
          h: rglItem.h,
        }
      })
    })
  }, [editing])

  // -- Remove widget ----------------------------------------------------------
  function removeWidget(widgetId: string) {
    setLayout(prev => prev.filter(item => item.widgetId !== widgetId))
  }

  // -- Add widget -------------------------------------------------------------
  function addWidget(widget: WidgetWithData) {
    setLayout(prev => {
      // Compute Y position: below all existing items
      let maxBottom = 0
      for (const item of prev) {
        maxBottom = Math.max(maxBottom, item.y + item.h)
      }
      const size = widget.defaultSize
      return [
        ...prev,
        { widgetId: widget.id, x: 0, y: maxBottom, w: size.w, h: size.h },
      ]
    })
    setShowPalette(false)
  }

  // -- Done editing -----------------------------------------------------------
  async function handleDone() {
    setEditing(false)
    setShowPalette(false)
    await saveLayout(layoutRef.current)
  }

  // -- Refresh a single widget with new settings ------------------------------
  async function refreshWidget(widgetId: string, settings: Record<string, unknown>) {
    try {
      const base = `/${pathSegment}/api/_dashboard/${dashboardId}`
      const tabParam = tabId ? `&tab=${tabId}` : ''
      const settingsParam = Object.keys(settings).length > 0
        ? `&settings=${encodeURIComponent(JSON.stringify(settings))}`
        : ''
      const res = await fetch(`${base}/widgets?widget=${widgetId}${tabParam}${settingsParam}`)
      if (res.ok) {
        const body = await res.json() as { widgets: WidgetWithData[] }
        const updated = body.widgets.find(w => w.id === widgetId)
        if (updated) {
          setWidgets(prev => prev.map(w => w.id === widgetId ? updated : w))
        }
      }
    } catch { /* refresh failed */ }
  }

  // -- Build active widgets (layout order) ------------------------------------
  const activeWidgets = layout
    .map(item => ({
      ...item,
      widget: widgets.find(w => w.id === item.widgetId),
    }))
    .filter(item => item.widget !== undefined)

  // Widgets not in the layout (for the palette)
  const availableWidgets = widgets.filter(
    w => !layout.some(item => item.widgetId === w.id)
  )

  // Don't render anything if no widgets registered at all
  if (!loading && widgets.length === 0) return null

  if (loading) {
    return (
      <div className="mt-6">
        <div className="h-8 w-48 animate-pulse bg-muted/30 rounded mb-4" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="col-span-2 h-32 animate-pulse bg-muted/20 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // Build react-grid-layout items
  const rglItems: RGLLayoutItem[] = activeWidgets.map(item => {
    const widgetMeta = defaultWidgets.find(w => w.id === item.widgetId)
    return {
      i:    item.widgetId,
      x:    item.x,
      y:    item.y,
      w:    item.w,
      h:    item.h,
      minW: widgetMeta?.minSize?.w ?? 2,
      minH: widgetMeta?.minSize?.h ?? 1,
      maxW: widgetMeta?.maxSize?.w ?? 12,
      maxH: widgetMeta?.maxSize?.h ?? 8,
      static: !editing,
    }
  })

  const rglLayouts: ResponsiveLayouts = {
    lg: rglItems,
  }

  const heading = label ?? i18n.dashboard ?? 'Dashboard'

  return (
    <div className="mt-6" ref={containerRef}>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{heading}</h2>
        {editable && (
          <div className="flex items-center gap-2">
            {editing && (
              <button
                type="button"
                onClick={() => setShowPalette(!showPalette)}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-accent transition-colors"
              >
                {i18n.addWidget ?? '+ Add Widget'}
              </button>
            )}
            <button
              type="button"
              onClick={editing ? handleDone : () => setEditing(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              {editing ? (i18n.doneDashboard ?? 'Done') : (i18n.customizeDashboard ?? 'Customize')}
            </button>
          </div>
        )}
      </div>

      {/* Widget palette (add widgets) */}
      {editing && showPalette && availableWidgets.length > 0 && (
        <div className="mb-4 p-4 rounded-xl border bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Available Widgets</p>
          <div className="flex flex-wrap gap-2">
            {availableWidgets.map(w => (
              <button
                key={w.id}
                type="button"
                onClick={() => addWidget(w)}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border bg-card hover:bg-accent transition-colors"
              >
                {w.icon && <span>{w.icon}</span>}
                <span>{w.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No widgets state */}
      {activeWidgets.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">{i18n.noWidgets ?? 'No widgets added yet.'}</p>
          {editable && !editing && (
            <button
              type="button"
              onClick={() => { setEditing(true); setShowPalette(true) }}
              className="mt-3 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              {i18n.addWidget ?? '+ Add Widget'}
            </button>
          )}
        </div>
      )}

      {/* Widget grid */}
      {activeWidgets.length > 0 && mounted && (
        <ResponsiveGridLayout
          className="layout"
          width={width}
          layouts={rglLayouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={COLS}
          rowHeight={ROW_HEIGHT}
          margin={[16, 16]}
          containerPadding={[0, 0]}
          resizeConfig={{ enabled: editing }}
          onLayoutChange={handleLayoutChange}
        >
          {activeWidgets.map(({ widgetId, widget }) => (
            <div key={widgetId} className="relative group h-full">
              {/* Edit overlay — settings + remove buttons */}
              {editing && (
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {widget!.settings && widget!.settings.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setSettingsWidgetId(widgetId) }}
                      className="w-5 h-5 flex items-center justify-center text-xs rounded bg-background/80 backdrop-blur border border-border hover:bg-accent transition-colors"
                      title="Settings"
                    >
                      {'\u2699'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeWidget(widgetId) }}
                    className="w-5 h-5 flex items-center justify-center text-xs rounded bg-background/80 backdrop-blur border border-border text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    title="Remove widget"
                  >
                    {'\u00d7'}
                  </button>
                </div>
              )}

              {/* Widget content */}
              <WidgetCard widget={widget!} panelPath={panelPath} i18n={i18n} />
            </div>
          ))}
        </ResponsiveGridLayout>
      )}

      {/* Widget settings drawer */}
      {settingsWidgetId && (() => {
        const widgetMeta = widgets.find(w => w.id === settingsWidgetId)
        const layoutItem = layout.find(l => l.widgetId === settingsWidgetId)
        if (!widgetMeta?.settings?.length) return null
        return (
          <WidgetSettingsDrawer
            widget={widgetMeta}
            currentSettings={layoutItem?.settings ?? {}}
            onSave={(newSettings) => {
              setLayout(prev => prev.map(item =>
                item.widgetId === settingsWidgetId
                  ? { ...item, settings: newSettings }
                  : item
              ))
              void refreshWidget(settingsWidgetId, newSettings)
              setSettingsWidgetId(null)
            }}
            onClose={() => setSettingsWidgetId(null)}
            i18n={i18n}
          />
        )
      })()}
    </div>
  )
}

// -- Widget card -- maps widget component type to schema element ---------------

function CustomWidgetLoader({ widget }: { widget: WidgetWithData }) {
  const [Comp, setComp] = useState<React.ComponentType<{ data: unknown; widget: WidgetWithData }> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!widget.componentPath) return
    import(/* @vite-ignore */ widget.componentPath)
      .then(mod => setComp(() => mod.default))
      .catch((err: unknown) => setError(String(err)))
  }, [widget.componentPath])

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 p-5 h-full">
        <p className="text-sm font-semibold text-red-600">{widget.label}</p>
        <p className="text-xs text-red-500 mt-1">Failed to load custom component</p>
      </div>
    )
  }

  if (!Comp) {
    return (
      <div className="rounded-xl border bg-card p-5 h-full animate-pulse">
        <div className="h-4 w-24 bg-muted/40 rounded mb-3" />
        <div className="h-16 bg-muted/20 rounded" />
      </div>
    )
  }

  return <Comp data={widget.data} widget={widget} />
}

function WidgetCard({ widget, panelPath, i18n }: { widget: WidgetWithData; panelPath: string; i18n: PanelI18n & Record<string, string> }) {
  const data = widget.data as Record<string, unknown> | null

  // Custom component escape hatch
  if (widget.component === 'custom' && widget.componentPath) {
    return (
      <div className="h-full">
        <CustomWidgetLoader widget={widget} />
      </div>
    )
  }

  // Map widget component type to PanelSchemaElementMeta
  let element: PanelSchemaElementMeta | null = null

  if (widget.component === 'stat') {
    element = {
      type: 'stats',
      stats: [{
        label: widget.label,
        value: (data?.value as number | string) ?? 0,
        ...(data?.description !== undefined && { description: data.description as string }),
        ...(data?.trend !== undefined && { trend: data.trend as number }),
      }],
    }
  } else if (widget.component === 'chart') {
    element = {
      type: 'chart',
      title: widget.label,
      chartType: (data?.type as string) ?? 'line',
      labels: (data?.labels as string[]) ?? [],
      datasets: (data?.datasets as any[]) ?? [],
      height: (data?.height as number) ?? 200,
    } as PanelSchemaElementMeta
  } else if (widget.component === 'table') {
    element = {
      type: 'table',
      title: widget.label,
      resource: '',
      columns: (data?.columns as any[]) ?? [],
      records: (data?.records as any[]) ?? [],
      href: (data?.href as string) ?? '#',
    }
  } else if (widget.component === 'list') {
    element = {
      type: 'list',
      title: widget.label,
      items: (data?.items as any[]) ?? [],
      limit: (data?.limit as number) ?? 5,
    } as PanelSchemaElementMeta
  } else if (widget.component === 'stat-progress') {
    element = {
      type: 'stat-progress',
      data: data ?? {},
    } as any
  } else if (widget.component === 'user-card') {
    element = {
      type: 'user-card',
      data: data ?? {},
    } as any
  }

  if (!element) {
    return (
      <div className="rounded-xl border bg-card p-5 h-full">
        <p className="text-sm font-semibold">{widget.label}</p>
        {data && <pre className="text-xs text-muted-foreground mt-2 overflow-auto">{JSON.stringify(data, null, 2)}</pre>}
      </div>
    )
  }

  return (
    <div className="h-full">
      <WidgetRenderer element={element} panelPath={panelPath} i18n={i18n} />
    </div>
  )
}
