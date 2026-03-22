'use client'

import { useState } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { navigate } from 'vike/client/router'
import { toast } from 'sonner'
import { SchemaTable } from '../../../_components/SchemaTable.js'
import type { SchemaTableResourceProps } from '../../../_components/SchemaTable.js'
import type { PanelSchemaElementMeta } from '@boostkit/panels'
import type { Data } from './+data.js'

function t(template: string, vars: Record<string, string | number>): string {
  return template.replace(/:([a-z]+)/g, (_, k: string) => String(vars[k] ?? `:${k}`))
}

export default function ResourceListPage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, tableElement, pathSegment, slug } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = panelMeta.i18n
  config({ title: `${resourceMeta.label} — ${panelName}` })

  // Read trashed state from the table element's SSR data or URL
  const [isTrashed, setIsTrashed] = useState(false)

  // Tab state — read from the table element's active state
  const activeTab = resourceMeta.tabs[0]?.label ?? ''
  const [currentTab, setCurrentTab] = useState(activeTab)

  const resourceProps: SchemaTableResourceProps = {
    resourceSlug: slug,
    tabs: resourceMeta.tabs.length > 0 ? resourceMeta.tabs.map((tab) => ({
      label: tab.label,
      icon:  tab.icon,
    })) : undefined,
    activeTab: currentTab,
    onTabChange: (label) => setCurrentTab(label),
    softDeletes: resourceMeta.softDeletes || undefined,
    isTrashed,
    onTrashedChange: (trashed) => setIsTrashed(trashed),
    createUrl: resourceMeta.draftable ? undefined : `/${pathSegment}/resources/${slug}/create`,
    emptyState: resourceMeta.emptyStateIcon || resourceMeta.emptyStateHeading || resourceMeta.emptyStateDescription
      ? {
          icon:        resourceMeta.emptyStateIcon,
          heading:     resourceMeta.emptyStateHeading,
          description: resourceMeta.emptyStateDescription,
        }
      : undefined,
  }

  // Cast the resolved table element
  const element = tableElement as Extract<PanelSchemaElementMeta, { type: 'table' }> | null

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className="text-xl font-semibold">
            {resourceMeta.label}
            {isTrashed && <span className="text-muted-foreground ms-2 text-base font-normal">— {i18n.trash}</span>}
          </h1>
          {element && (element as any).pagination && (
            <p className="text-sm text-muted-foreground mt-0.5">{t(i18n.records, { n: (element as any).pagination.total })}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isTrashed && resourceMeta.draftable && (
            <CreateDraftButton slug={slug} pathSegment={pathSegment} labelSingular={resourceMeta.labelSingular} i18n={i18n} />
          )}
          {!isTrashed && !resourceMeta.draftable && (
            <a
              href={`/${pathSegment}/resources/${slug}/create`}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity shrink-0"
            >
              {t(i18n.newButton, { label: resourceMeta.labelSingular })}
            </a>
          )}
        </div>
      </div>

      {/* Trashed banner */}
      {isTrashed && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-700 dark:text-amber-400">
          {i18n.trashedBanner}
        </div>
      )}

      {/* Table — resolved through the same pipeline as standalone SchemaTable */}
      {element ? (
        <SchemaTable element={element} panelPath={`/${pathSegment}`} i18n={i18n} resource={resourceProps} />
      ) : (
        <p className="text-sm text-muted-foreground">{i18n.noRecordsFound}</p>
      )}
    </>
  )
}

/* ── CreateDraftButton ────────────────────────────────────── */

function CreateDraftButton({ slug, pathSegment, labelSingular, i18n }: {
  slug: string; pathSegment: string; labelSingular: string; i18n: Record<string, any>
}) {
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    setCreating(true)
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ draftStatus: 'draft' }),
      })
      if (res.ok) {
        const body = await res.json() as { data: { id: string } }
        void navigate(`/${pathSegment}/resources/${slug}/${body.data.id}/edit`)
      } else {
        toast.error(i18n.saveError ?? 'Failed to create draft.')
        setCreating(false)
      }
    } catch {
      toast.error(i18n.saveError ?? 'Failed to create draft.')
      setCreating(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCreate}
      disabled={creating}
      className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity shrink-0 disabled:opacity-50"
    >
      {creating ? i18n.loading : t(i18n.newButton, { label: labelSingular })}
    </button>
  )
}
