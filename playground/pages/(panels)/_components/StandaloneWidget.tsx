'use client'

import { useState, useEffect } from 'react'
import { WidgetCard } from './WidgetCard.js'
import type { WidgetWithData } from './WidgetCard.js'
import type { PanelI18n } from '@boostkit/panels'

interface Props {
  widget:      WidgetWithData
  panelPath:   string
  pathSegment: string
  i18n:        PanelI18n & Record<string, string>
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

  // Pass widget with current data to the shared WidgetCard
  const widgetWithData: WidgetWithData = { ...widget, data }

  return <WidgetCard widget={widgetWithData} panelPath={panelPath} i18n={i18n} />
}
