'use client'

import { useState, useEffect } from 'react'
import { SchemaElementRenderer } from './SchemaElementRenderer.js'
import type { PanelSchemaElementMeta, PanelI18n } from '@boostkit/panels'
import type { WidgetMeta } from '@boostkit/panels'

export interface WidgetWithSchema extends WidgetMeta {
  schema?: PanelSchemaElementMeta[]
}

// ── Icon — supports emoji and lucide icon names ─────────────────────────────
// Icons are lazy-loaded via the shared cache in ResourceIcon (avoids bundling all ~2k icons).

type IconComponent = React.ComponentType<{ className?: string }>
let iconsCache: Record<string, IconComponent> | null = null
let loadPromise: Promise<void> | null = null
function loadIcons(): Promise<void> {
  if (iconsCache) return Promise.resolve()
  if (!loadPromise) {
    loadPromise = import('lucide-react').then((mod) => {
      iconsCache = mod.icons as Record<string, IconComponent>
    }).catch(() => { iconsCache = {} })
  }
  return loadPromise
}

export function WidgetIcon({ icon, className }: { icon: string; className?: string }) {
  const pascalName = icon.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
  const [LucideIcon, setLucideIcon] = useState<IconComponent | null>(() =>
    iconsCache?.[pascalName] ?? null,
  )

  useEffect(() => {
    if (iconsCache) { setLucideIcon(() => iconsCache?.[pascalName] ?? null); return }
    loadIcons().then(() => { setLucideIcon(() => iconsCache?.[pascalName] ?? null) }).catch(() => {})
  }, [pascalName])

  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(icon)) {
    return <span className={className}>{icon}</span>
  }
  if (LucideIcon) return <LucideIcon className={className} />
  return <span className={className}>{icon}</span>
}

// ── Widget card — renders resolved schema elements ──────────────────────────

export function WidgetCard({ widget, panelPath, i18n }: {
  widget:    WidgetWithSchema
  panelPath: string
  i18n:      PanelI18n & Record<string, string>
}) {
  // Custom component via .render()
  if (widget.componentPath) {
    return <CustomWidgetLoader widget={widget} />
  }

  // Render resolved schema elements
  const schema = widget.schema
  if (!schema || schema.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-5 h-full">
        <p className="text-sm font-semibold">{widget.label}</p>
        <p className="text-xs text-muted-foreground mt-1">No content</p>
      </div>
    )
  }

  return (
    <div className="h-full">
      {schema.map((element, i) => (
        <SchemaElementRenderer key={i} element={element} panelPath={panelPath} i18n={i18n} />
      ))}
    </div>
  )
}

// ── Custom component loader ─────────────────────────────────────────────────

function CustomWidgetLoader({ widget }: { widget: WidgetWithSchema }) {
  const [Comp, setComp] = useState<React.ComponentType<{ widget: WidgetWithSchema }> | null>(null)
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

  return <Comp widget={widget} />
}
