'use client'

import { useState, useEffect } from 'react'
import { WidgetRenderer } from './WidgetRenderer.js'
import { icons as lucideIcons } from 'lucide-react'
import type { PanelSchemaElementMeta, PanelI18n } from '@boostkit/panels'
import type { WidgetMeta } from '@boostkit/panels'

export interface WidgetWithData extends WidgetMeta {
  data: unknown
}

// ── Icon — supports emoji and lucide icon names ─────────────────────────────

export function WidgetIcon({ icon, className }: { icon: string; className?: string }) {
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

// ── Widget card — maps widget component type to rendered output ──────────────

export function WidgetCard({ widget, panelPath, i18n }: {
  widget:    WidgetWithData
  panelPath: string
  i18n:      PanelI18n & Record<string, string>
}) {
  const data = widget.data as Record<string, unknown> | null

  // Custom component
  if (widget.component === 'custom' && widget.componentPath) {
    return <CustomWidgetLoader widget={widget} />
  }

  // Stat with icon
  if (widget.component === 'stat') {
    return (
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-1 h-full">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{widget.label}</p>
          {widget.icon && <WidgetIcon icon={widget.icon} className="w-5 h-5 text-muted-foreground" />}
        </div>
        <p className="text-3xl font-bold tabular-nums">{((data?.value as number | string) ?? 0).toLocaleString()}</p>
        {data?.description !== undefined && (
          <p className="text-xs text-muted-foreground mt-0.5">{String(data.description)}</p>
        )}
        {data?.trend !== undefined && (
          <p className={`text-xs font-medium mt-0.5 ${(data.trend as number) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {(data.trend as number) >= 0 ? '\u2191' : '\u2193'} {Math.abs(data.trend as number)}%
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
      chartType: (data?.type as string) ?? 'line',
      labels: (data?.labels as string[]) ?? [],
      datasets: (data?.datasets as any[]) ?? [],
      height: (data?.height as number) ?? Math.max((widget.defaultSize.h * 80) - 60, 180),
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
    element = { type: 'stat-progress', data: data ?? {} } as any
  } else if (widget.component === 'user-card') {
    element = { type: 'user-card', data: data ?? {} } as any
  }

  if (!element) {
    return (
      <div className="rounded-xl border bg-card p-5 h-full">
        <p className="text-sm font-semibold">{widget.label}</p>
        {data && <pre className="text-xs text-muted-foreground mt-2 overflow-auto">{JSON.stringify(data, null, 2)}</pre>}
      </div>
    )
  }

  return <WidgetRenderer element={element} panelPath={panelPath} i18n={i18n} />
}

// ── Custom component loader ─────────────────────────────────────────────────

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
        <p className="text-xs text-red-500 mt-1">Failed to load component</p>
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
