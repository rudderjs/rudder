'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { WidgetSettingsDrawer } from './WidgetSettingsDrawer.js'
import { WidgetCard } from './WidgetCard.js'
import type { WidgetWithSchema } from './WidgetCard.js'
import type { PanelI18n } from '@boostkit/panels'
import type { WidgetMeta } from '@boostkit/panels'

// ── Size presets ────────────────────────────────────────────────────────────

const SIZE_PRESETS = [
  { label: '1/4', w: 3 },
  { label: '1/3', w: 4 },
  { label: '1/2', w: 6 },
  { label: '2/3', w: 8 },
  { label: 'Full', w: 12 },
] as const

/** Clamp width to valid 12-col span. */
function clampSpan(w: number): number {
  return Math.max(1, Math.min(12, w))
}

// ── Types ───────────────────────────────────────────────────────────────────

interface DashboardLayoutItem {
  widgetId:  string
  w:         number
  settings?: Record<string, unknown>
}


export interface DashboardGridProps {
  dashboardId:    string
  label?:         string | undefined
  editable?:      boolean | undefined
  defaultWidgets: WidgetMeta[]
  ssrWidgets?:    WidgetWithSchema[] | undefined
  ssrLayout?:     DashboardLayoutItem[] | undefined
  pathSegment:    string
  panelPath:      string
  i18n:           PanelI18n & Record<string, string>
}

/** Build default layout from widget definitions. */
function computeDefaultLayout(widgets: WidgetMeta[]): DashboardLayoutItem[] {
  return widgets.map(w => ({
    widgetId: w.id,
    w: w.defaultSize.w,
  }))
}

// ── Sortable widget wrapper ─────────────────────────────────────────────────

interface SortableWidgetProps {
  id:        string
  span:      number
  minHeight?: number | undefined
  editing:   boolean
  children:  React.ReactNode
}

function SortableWidget({ id, span, minHeight, editing, children }: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !editing })

  const style: React.CSSProperties = {
    gridColumn: `span ${span}`,
    // Only translate — don't let dnd-kit scale/resize the element
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
    ...(minHeight ? { minHeight } : {}),
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="relative group">
      {editing && (
        <div
          {...listeners}
          className="absolute top-2 left-2 z-10 w-6 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing rounded bg-background/80 backdrop-blur border border-border opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground"
          title="Drag to reorder"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="5" cy="3" r="1.5" />
            <circle cx="11" cy="3" r="1.5" />
            <circle cx="5" cy="8" r="1.5" />
            <circle cx="11" cy="8" r="1.5" />
            <circle cx="5" cy="13" r="1.5" />
            <circle cx="11" cy="13" r="1.5" />
          </svg>
        </div>
      )}
      {children}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function DashboardGrid({
  dashboardId,
  label,
  editable = true,
  defaultWidgets,
  ssrWidgets,
  ssrLayout,
  pathSegment,
  panelPath,
  i18n,
}: DashboardGridProps) {
  const hasSSR = ssrWidgets && ssrWidgets.length > 0
  const hasSSRLayout = ssrLayout && ssrLayout.length > 0
  const [widgets, setWidgets] = useState<WidgetWithSchema[]>(hasSSR ? ssrWidgets : [])
  const [layout, setLayout] = useState<DashboardLayoutItem[]>(
    hasSSRLayout ? ssrLayout : (hasSSR ? computeDefaultLayout(defaultWidgets) : [])
  )
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(!hasSSR)
  const [showPalette, setShowPalette] = useState(false)
  const [settingsWidgetId, setSettingsWidgetId] = useState<string | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // ── Load widgets + layout ───────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      // Use SSR widgets if available (skip API for non-lazy)
      if (ssrWidgets && ssrWidgets.length > 0) {
        setWidgets(ssrWidgets)

        // Fetch lazy widgets via API
        const lazyIds = ssrWidgets.filter(w => w.lazy && !w.schema).map(w => w.id)
        if (lazyIds.length > 0) {
          try {
            const base = `/${pathSegment}/api/_dashboard/${dashboardId}`
            const res = await fetch(`${base}/widgets`)
            if (res.ok) {
              const body = await res.json() as { widgets: WidgetWithSchema[] }
              setWidgets(prev => prev.map(w => {
                if (!lazyIds.includes(w.id)) return w
                const fresh = body.widgets.find(fw => fw.id === w.id)
                return fresh ?? w
              }))
            }
          } catch { /* lazy fetch failed */ }
        }
      } else {
        // No SSR data — fetch everything via API (fallback)
        try {
          const base = `/${pathSegment}/api/_dashboard/${dashboardId}`
          const res = await fetch(`${base}/widgets`)
          if (res.ok) {
            const body = await res.json() as { widgets: WidgetWithSchema[] }
            setWidgets(body.widgets)
          }
        } catch { /* fetch failed */ }
      }

      // Load layout (skip if SSR layout already provided)
      if (hasSSRLayout) {
        setLoading(false)
        return
      }
      try {
        const base = `/${pathSegment}/api/_dashboard/${dashboardId}`
        const res = await fetch(`${base}/layout`)
        if (res.ok) {
          const body = await res.json() as { layout: Array<{ widgetId: string; w?: unknown; size?: { w?: number }; settings?: Record<string, unknown> }> }
          if (body.layout.length > 0) {
            // Normalize: ensure each item has a numeric `w` (migrate from old format)
            const normalized: DashboardLayoutItem[] = body.layout.map((item) => {
              const widgetDef = defaultWidgets.find(d => d.id === item.widgetId)
              return {
                widgetId: item.widgetId,
                w: typeof item.w === 'number' ? item.w : (widgetDef?.defaultSize.w ?? 6),
                ...(item.settings && { settings: item.settings }),
              }
            })
            setLayout(normalized)
          } else {
            setLayout(computeDefaultLayout(defaultWidgets))
          }
        } else {
          setLayout(computeDefaultLayout(defaultWidgets))
        }
      } catch {
        setLayout(computeDefaultLayout(defaultWidgets))
      }

      setLoading(false)
    }
    void load()
  }, [pathSegment, dashboardId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Polling — re-fetch widgets with pollInterval ───────────────────────
  useEffect(() => {
    const pollingWidgets = widgets.filter(w => w.pollInterval && w.pollInterval > 0)
    if (pollingWidgets.length === 0) return

    const timers: ReturnType<typeof setInterval>[] = []

    for (const pw of pollingWidgets) {
      const timer = setInterval(async () => {
        try {
          const base = `/${pathSegment}/api/_dashboard/${dashboardId}`
          const res = await fetch(`${base}/widgets?widget=${pw.id}`)
          if (res.ok) {
            const body = await res.json() as { widgets: WidgetWithSchema[] }
            const fresh = body.widgets.find(w => w.id === pw.id)
            if (fresh) {
              setWidgets(prev => prev.map(w => w.id === pw.id ? fresh : w))
            }
          }
        } catch { /* poll failed */ }
      }, pw.pollInterval ?? 0)
      timers.push(timer)
    }

    return () => timers.forEach(t => clearInterval(t))
  }, [widgets.map(w => `${w.id}:${w.pollInterval}`).join(','), pathSegment, dashboardId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save layout ─────────────────────────────────────────────────────────
  const saveLayout = useCallback(async (newLayout: DashboardLayoutItem[]) => {
    try {
      const base = `/${pathSegment}/api/_dashboard/${dashboardId}`
      await fetch(`${base}/layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: newLayout }),
      })
    } catch (err) { console.error('[DashboardGrid] save failed:', err) }
  }, [pathSegment, dashboardId])

  // ── Drag end — reorder ──────────────────────────────────────────────────
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setLayout(prev => {
      const oldIdx = prev.findIndex(item => item.widgetId === active.id)
      const newIdx = prev.findIndex(item => item.widgetId === over.id)
      if (oldIdx === -1 || newIdx === -1) return prev
      return arrayMove(prev, oldIdx, newIdx)
    })
  }

  // ── Change widget size ──────────────────────────────────────────────────
  function setWidgetSize(widgetId: string, w: number) {
    setLayout(prev => prev.map(item =>
      item.widgetId === widgetId ? { ...item, w } : item
    ))
  }

  // ── Remove widget ───────────────────────────────────────────────────────
  function removeWidget(widgetId: string) {
    setLayout(prev => prev.filter(item => item.widgetId !== widgetId))
  }

  // ── Add widget ──────────────────────────────────────────────────────────
  function addWidget(widget: WidgetWithSchema) {
    setLayout(prev => [...prev, { widgetId: widget.id, w: widget.defaultSize.w }])
    setShowPalette(false)
  }

  // ── Done editing ────────────────────────────────────────────────────────
  async function handleDone() {
    setEditing(false)
    setShowPalette(false)
    await saveLayout(layoutRef.current)
  }

  // ── Refresh single widget ──────────────────────────────────────────────
  async function refreshWidget(widgetId: string, settings: Record<string, unknown>) {
    try {
      const base = `/${pathSegment}/api/_dashboard/${dashboardId}`
      const settingsParam = Object.keys(settings).length > 0
        ? `&settings=${encodeURIComponent(JSON.stringify(settings))}`
        : ''
      const res = await fetch(`${base}/widgets?widget=${widgetId}${settingsParam}`)
      if (res.ok) {
        const body = await res.json() as { widgets: WidgetWithSchema[] }
        const updated = body.widgets.find(w => w.id === widgetId)
        if (updated) {
          setWidgets(prev => prev.map(w => w.id === widgetId ? updated : w))
        }
      }
    } catch { /* refresh failed */ }
  }

  // ── Build active widgets ───────────────────────────────────────────────
  const activeWidgets = layout
    .map(item => ({ ...item, widget: widgets.find(w => w.id === item.widgetId) }))
    .filter(item => item.widget !== undefined)

  const availableWidgets = widgets.filter(w => !layout.some(item => item.widgetId === w.id))

  if (!loading && widgets.length === 0) return null

  if (loading) {
    return (
      <div className="mt-6">
        <div className="h-8 w-48 animate-pulse bg-muted/30 rounded mb-4" />
        <div className="grid grid-cols-12 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="col-span-2 h-32 animate-pulse bg-muted/20 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const heading = label ?? i18n.dashboard ?? 'Dashboard'
  const widgetIds = activeWidgets.map(w => w.widgetId)

  return (
    <div className="mt-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{heading}</h2>
        {editable && (
          <div className="flex items-center gap-2">
            {editing && availableWidgets.length > 0 && (
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

      {/* Palette */}
      {editing && showPalette && availableWidgets.length > 0 && (
        <div className="mb-4 p-4 rounded-xl border bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
            {i18n.availableWidgets ?? 'Available Widgets'}
          </p>
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

      {/* Empty state */}
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
      {activeWidgets.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={widgetIds} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-12 gap-4">
              {activeWidgets.map(({ widgetId, w, widget }) => {
                const span = clampSpan(w)
                return (
                  <SortableWidget
                    key={widgetId}
                    id={widgetId}
                    span={span}
                    editing={editing}
                  >
                    {/* Edit controls */}
                    {editing && (
                      <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {widget?.settings && widget.settings.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSettingsWidgetId(widgetId)}
                            className="w-5 h-5 flex items-center justify-center text-xs rounded bg-background/80 backdrop-blur border border-border hover:bg-accent transition-colors"
                            title="Settings"
                          >
                            ⚙
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeWidget(widgetId)}
                          className="w-5 h-5 flex items-center justify-center text-xs rounded bg-background/80 backdrop-blur border border-border text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    )}

                    {/* Size presets — shown in edit mode at bottom */}
                    {editing && (
                      <div className="absolute bottom-2 left-2 right-2 z-10 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {SIZE_PRESETS.map(preset => (
                          <button
                            key={preset.w}
                            type="button"
                            onClick={() => setWidgetSize(widgetId, preset.w)}
                            className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${
                              w === preset.w
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-background/80 backdrop-blur border border-border hover:bg-accent'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Widget content */}
                    <div className="h-full">
                      {widget && <WidgetCard widget={widget} panelPath={panelPath} i18n={i18n} />}
                    </div>
                  </SortableWidget>
                )
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Settings drawer */}
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

// WidgetCard, WidgetIcon, and CustomWidgetLoader imported from ./WidgetCard.tsx
