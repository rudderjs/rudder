'use client'

import { useState, useEffect } from 'react'
import { WidgetCard } from './WidgetCard.js'
import type { WidgetWithSchema } from './WidgetCard.js'
import type { PanelI18n } from '@rudderjs/panels'

interface Props {
  widget:      WidgetWithSchema
  panelPath:   string
  pathSegment: string
  i18n:        PanelI18n & Record<string, string>
}

/**
 * Renders a standalone Widget directly in the schema — static, SSR, no customization.
 * Supports lazy loading and polling.
 */
export function StandaloneWidget({ widget, panelPath, pathSegment, i18n }: Props) {
  const [schema, setSchema] = useState(widget.schema)
  const [loading, setLoading] = useState(widget.lazy === true && !widget.schema)

  // Lazy fetch
  useEffect(() => {
    if (!widget.lazy || widget.schema) return
    async function fetchSchema() {
      try {
        const res = await fetch(`/${pathSegment}/api/_widgets/${widget.id}`)
        if (res.ok) {
          const body = await res.json() as { widget: WidgetWithSchema }
          if (body.widget?.schema) setSchema(body.widget.schema)
        }
      } catch { /* failed */ }
      setLoading(false)
    }
    void fetchSchema()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Polling
  useEffect(() => {
    if (!widget.pollInterval || widget.pollInterval <= 0) return
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/${pathSegment}/api/_widgets/${widget.id}`)
        if (res.ok) {
          const body = await res.json() as { widget: WidgetWithSchema }
          if (body.widget?.schema) setSchema(body.widget.schema)
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

  const widgetWithSchema: WidgetWithSchema = { ...widget, schema }
  return <WidgetCard widget={widgetWithSchema} panelPath={panelPath} i18n={i18n} />
}
