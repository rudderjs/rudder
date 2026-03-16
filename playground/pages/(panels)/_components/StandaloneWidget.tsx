'use client'

import { useState, useEffect } from 'react'
import { WidgetRenderer } from './WidgetRenderer.js'
import { icons as lucideIcons } from 'lucide-react'
import type { PanelSchemaElementMeta, PanelI18n } from '@boostkit/panels'
import type { WidgetMeta } from '@boostkit/dashboards'

interface WidgetWithData extends WidgetMeta {
  type: 'widget'
  data: unknown
}

interface Props {
  widget:      WidgetWithData
  panelPath:   string
  pathSegment: string
  i18n:        PanelI18n & Record<string, string>
}

function WidgetIcon({ icon, className }: { icon: string; className?: string }) {
  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(icon)) {
    return <span className={className}>{icon}</span>
  }
  const pascalName = icon
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('') as keyof typeof lucideIcons
  const LucideIcon = lucideIcons[pascalName]
  if (LucideIcon) return <LucideIcon className={className} />
  return <span className={className}>{icon}</span>
}

/**
 * Renders a standalone Widget directly in the schema — static, SSR, no customization.
 * Supports lazy loading and polling.
 */
export function StandaloneWidget({ widget, panelPath, pathSegment, i18n }: Props) {
  const [data, setData] = useState<unknown>(widget.data)
  const [loading, setLoading] = useState(widget.lazy === true && !widget.data)

  // Lazy fetch
  useEffect(() => {
    if (!widget.lazy || widget.data) return
    async function fetchData() {
      try {
        // Use the dashboard widget API to fetch single widget data
        // Standalone widgets aren't in a dashboard, so we use a direct approach
        // For now, the data function already ran server-side (unless lazy)
        // Lazy widgets need a dedicated fetch — we'll use the widget data endpoint
        const res = await fetch(`/${pathSegment}/api/_dashboard/_standalone/widgets?widget=${widget.id}`)
        if (res.ok) {
          const body = await res.json() as { widgets: WidgetWithData[] }
          const fresh = body.widgets.find(w => w.id === widget.id)
          if (fresh) setData(fresh.data)
        }
      } catch { /* failed */ }
      setLoading(false)
    }
    void fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Polling
  useEffect(() => {
    if (!widget.pollInterval || widget.pollInterval <= 0) return
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/${pathSegment}/api/_dashboard/_standalone/widgets?widget=${widget.id}`)
        if (res.ok) {
          const body = await res.json() as { widgets: WidgetWithData[] }
          const fresh = body.widgets.find(w => w.id === widget.id)
          if (fresh) setData(fresh.data)
        }
      } catch { /* failed */ }
    }, widget.pollInterval)
    return () => clearInterval(timer)
  }, [widget.id, widget.pollInterval]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="rounded-xl border bg-card p-5 animate-pulse">
        <div className="h-4 w-24 bg-muted/40 rounded mb-3" />
        <div className="h-8 w-16 bg-muted/30 rounded" />
      </div>
    )
  }

  const d = data as Record<string, unknown> | null

  // Stat widget — custom render with icon
  if (widget.component === 'stat') {
    return (
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{widget.label}</p>
          {widget.icon && <WidgetIcon icon={widget.icon} className="w-5 h-5 text-muted-foreground" />}
        </div>
        <p className="text-3xl font-bold tabular-nums">{((d?.value as number | string) ?? 0).toLocaleString()}</p>
        {d?.description !== undefined && (
          <p className="text-xs text-muted-foreground mt-0.5">{String(d.description)}</p>
        )}
        {d?.trend !== undefined && (
          <p className={`text-xs font-medium mt-0.5 ${(d.trend as number) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {(d.trend as number) >= 0 ? '↑' : '↓'} {Math.abs(d.trend as number)}%
          </p>
        )}
      </div>
    )
  }

  // Map other types to WidgetRenderer
  let element: PanelSchemaElementMeta | null = null

  if (widget.component === 'chart') {
    element = {
      type: 'chart',
      title: widget.label,
      chartType: (d?.type as string) ?? 'line',
      labels: (d?.labels as string[]) ?? [],
      datasets: (d?.datasets as any[]) ?? [],
      height: (d?.height as number) ?? 250,
    } as PanelSchemaElementMeta
  } else if (widget.component === 'table') {
    element = {
      type: 'table',
      title: widget.label,
      resource: '',
      columns: (d?.columns as any[]) ?? [],
      records: (d?.records as any[]) ?? [],
      href: (d?.href as string) ?? '#',
    }
  } else if (widget.component === 'list') {
    element = {
      type: 'list',
      title: widget.label,
      items: (d?.items as any[]) ?? [],
      limit: (d?.limit as number) ?? 5,
    } as PanelSchemaElementMeta
  } else if (widget.component === 'stat-progress') {
    element = { type: 'stat-progress', data: d ?? {} } as any
  } else if (widget.component === 'user-card') {
    element = { type: 'user-card', data: d ?? {} } as any
  }

  if (!element) {
    return (
      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm font-semibold">{widget.label}</p>
        {d && <pre className="text-xs text-muted-foreground mt-2">{JSON.stringify(d, null, 2)}</pre>}
      </div>
    )
  }

  return <WidgetRenderer element={element} panelPath={panelPath} i18n={i18n} />
}
