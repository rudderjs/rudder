'use client'

import { useState } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { navigate } from 'vike/client/router'
import { toast } from 'sonner'
import { SchemaTable } from '../../../_components/SchemaTable.js'
import type { SchemaTableResourceProps } from '../../../_components/SchemaTable.js'
import { SchemaTabs } from '../../../_components/SchemaTabs.js'
import type { PanelSchemaElementMeta } from '@boostkit/panels'
import { t } from '../../../_lib/formHelpers.js'
import type { Data } from './+data.js'

export default function ResourceListPage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, tableElement, tabsElement, pathSegment, slug } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = panelMeta.i18n
  config({ title: `${resourceMeta.label} — ${panelName}` })

  const [isTrashed, setIsTrashed] = useState(false)

  // Resource props for SchemaTable (used when no tabs)
  const resourceProps: SchemaTableResourceProps = {
    resourceSlug: slug,
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

  const element = tableElement as Extract<PanelSchemaElementMeta, { type: 'table' }> | null
  const tabsMeta = tabsElement as { type: 'tabs'; id?: string; tabs: any[]; persist?: string; activeTab?: number } | null

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className="text-xl font-semibold">
            {resourceMeta.label}
            {isTrashed && <span className="text-muted-foreground ms-2 text-base font-normal">— {i18n.trash}</span>}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {resourceMeta.softDeletes && (
            <button
              type="button"
              onClick={() => setIsTrashed(!isTrashed)}
              className={[
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors',
                isTrashed
                  ? 'border-primary text-primary bg-primary/10 hover:bg-primary/20 font-medium'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              ].join(' ')}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              {isTrashed ? (i18n.exitTrash ?? 'Exit trash') : (i18n.viewTrash ?? 'View trash')}
            </button>
          )}
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

      {/* Tabs mode: SchemaTabs wrapping per-tab SchemaTable */}
      {tabsMeta ? (
        <SchemaTabs
          id={tabsMeta.id}
          tabs={tabsMeta.tabs}
          panelPath={`/${pathSegment}`}
          pathSegment={pathSegment}
          i18n={i18n}
          persist={tabsMeta.persist as any}
          activeTab={tabsMeta.activeTab}
        />
      ) : element ? (
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
