'use client'

import { useState, useEffect, useRef } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { navigate } from 'vike/client/router'
import { toast } from 'sonner'
import { Checkbox } from '@base-ui-components/react/checkbox'
import { ConfirmDialog } from '../../_components/ConfirmDialog.js'
import type { FieldMeta, SectionMeta, TabsMeta, PanelI18n } from '@boostkit/panels'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.js'
import { Badge } from '@/components/ui/badge.js'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip.js'
import { useLiveTable } from '../../_hooks/useLiveTable.js'
import type { Data } from './+data.js'

type SchemaItem = FieldMeta | SectionMeta | TabsMeta

function flattenFields(schema: SchemaItem[]): FieldMeta[] {
  const result: FieldMeta[] = []
  for (const item of schema) {
    if (item.type === 'section') {
      result.push(...(item as SectionMeta).fields)
    } else if (item.type === 'tabs') {
      for (const tab of (item as TabsMeta).tabs) result.push(...tab.fields)
    } else {
      result.push(item as FieldMeta)
    }
  }
  return result
}

function t(template: string, vars: Record<string, string | number>): string {
  return template.replace(/:([a-z]+)/g, (_, k: string) => String(vars[k] ?? `:${k}`))
}

export default function ResourceListPage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, records, pagination, pathSegment, slug, urlSearch } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = panelMeta.i18n
  config({ title: `${resourceMeta.label} — ${panelName}` })

  const [selected,       setSelected]       = useState<string[]>([])
  const [confirm,        setConfirm]        = useState<{ action: typeof resourceMeta.actions[0]; records: unknown[] } | null>(null)
  const [actionPending,  setActionPending]  = useState(false)
  const [bulkDeletePending,     setBulkDeletePending]     = useState(false)
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false)

  // ── Load-more state ──────────────────────────────────
  const isLoadMore = resourceMeta.paginationType === 'loadMore'
  const [extraRecords,     setExtraRecords]     = useState<unknown[]>([])
  const [loadMorePending,  setLoadMorePending]  = useState(false)
  const allRecords = isLoadMore ? [...(records as unknown[]), ...extraRecords] : records as unknown[]
  const hasMorePages = isLoadMore && pagination != null && allRecords.length < pagination.total

  const allFields    = flattenFields(resourceMeta.fields as SchemaItem[])
  const tableFields  = allFields.filter((f) => !f.hidden.includes('table'))
  const sortFields   = allFields.filter((f) => f.sortable)
  const searchFields = allFields.filter((f) => f.searchable)
  const hasSearch    = searchFields.length > 0
  const hasFilters   = resourceMeta.filters.length > 0

  // ── Live table auto-refresh (opt-in via Resource.live) ──
  useLiveTable({ enabled: resourceMeta.live, slug, pathSegment })

  // ── Persist table state (opt-in via Resource.persistTableState) ──
  const storageKey          = `panels:${pathSegment}:${slug}:tableState`
  const selectionStorageKey = `panels:${pathSegment}:${slug}:selected`
  const persist = resourceMeta.persistTableState

  // Compute on every render: does the URL lack params but sessionStorage has saved ones?
  const needsRestore = persist
    && typeof window !== 'undefined'
    && !urlSearch
    && !!sessionStorage.getItem(storageKey)

  // Save params to sessionStorage whenever URL has them
  // In loadMore mode, once extra pages are loaded, handleLoadMore saves the updated URL directly
  // — skip the render-time save to avoid overwriting with stale SSR urlSearch
  if (persist && typeof window !== 'undefined' && urlSearch && !(isLoadMore && extraRecords.length > 0)) {
    sessionStorage.setItem(storageKey, '?' + urlSearch)
  }

  // Trigger the restore navigation (once per restore)
  const restoredRef = useRef<string | null>(null)
  useEffect(() => {
    if (!needsRestore) return
    const saved = sessionStorage.getItem(storageKey)
    if (saved && restoredRef.current !== storageKey) {
      restoredRef.current = storageKey
      void navigate(`${window.location.pathname}${saved}`, { overwriteLastHistoryEntry: true })
    }
  }) // no deps — runs every render but the ref guard prevents re-firing

  // ── Current URL params (use SSR-provided urlSearch to avoid hydration mismatch) ──
  const urlParams  = new URLSearchParams(urlSearch)
  const currentSort   = urlParams.get('sort') ?? resourceMeta.defaultSort ?? ''
  const currentDir    = (urlParams.get('dir') ?? resourceMeta.defaultSortDir ?? 'ASC') as 'ASC' | 'DESC'
  const currentSearch = urlParams.get('search') ?? ''
  const hasActiveFilters = urlParams.has('search') || [...urlParams.keys()].some((k) => k.startsWith('filter['))

  // Reset selection and loadMore state when navigating to a different resource
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // Restore persisted selection for this resource
    if (persist) {
      const saved = sessionStorage.getItem(selectionStorageKey)
      setSelected(saved ? JSON.parse(saved) as string[] : [])
    } else {
      setSelected([])
    }
    setExtraRecords([])
    restoredRef.current = null  // allow restore for the new resource
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist selection changes
  useEffect(() => {
    if (!persist) return
    if (selected.length > 0) sessionStorage.setItem(selectionStorageKey, JSON.stringify(selected))
    else sessionStorage.removeItem(selectionStorageKey)
  }, [selected, persist, selectionStorageKey])

  // In loadMore mode, handle browser back/forward by triggering a full Vike navigation
  useEffect(() => {
    if (!isLoadMore) return
    function onPopState() {
      void navigate(window.location.pathname + window.location.search, { overwriteLastHistoryEntry: true })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [isLoadMore, pathSegment, slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync search input value with URL (covers restore + navigation)
  useEffect(() => {
    if (searchRef.current) searchRef.current.value = currentSearch
  }, [currentSearch])

  // Reset loadMore accumulated records when SSR data changes (filter/sort/search)
  const recordsRef = useRef(records)
  useEffect(() => {
    if (recordsRef.current !== records) {
      recordsRef.current = records
      setExtraRecords([])
    }
  }, [records, pagination?.currentPage])

  async function handleLoadMore() {
    if (!pagination || loadMorePending) return
    // Compute next page from how many records we already have
    const currentCount = (records as unknown[]).length + extraRecords.length
    const nextPage = Math.floor(currentCount / pagination.perPage) + 1
    setLoadMorePending(true)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('page', String(nextPage))
      const res = await fetch(`/${pathSegment}/api/${slug}${url.search}`)
      if (res.ok) {
        const body = await res.json() as { data: unknown[] }
        setExtraRecords((prev) => [...prev, ...body.data])
        // Update URL without navigation so persistTableState can save the position
        window.history.pushState(null, '', url.pathname + url.search)
        if (persist) sessionStorage.setItem(storageKey, url.search)
      }
    } catch { /* ignore */ }
    finally { setLoadMorePending(false) }
  }


  /** Navigate and persist query string to sessionStorage */
  function navigateAndPersist(url: URL) {
    if (persist) {
      const search = url.search || ''
      if (search && search !== '?') sessionStorage.setItem(storageKey, search)
      else sessionStorage.removeItem(storageKey)
    }
    void navigate(url.pathname + url.search)
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault()
    const q   = searchRef.current?.value ?? ''
    const url = new URL(window.location.href)
    if (q) url.searchParams.set('search', q)
    else url.searchParams.delete('search')
    url.searchParams.delete('page')
    navigateAndPersist(url)
  }

  // ── Sort ────────────────────────────────────────────────
  function toggleSort(col: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('sort', col)
    if (currentSort === col) {
      url.searchParams.set('dir', currentDir === 'ASC' ? 'DESC' : 'ASC')
    } else {
      url.searchParams.set('dir', 'ASC')
    }
    url.searchParams.delete('page')
    navigateAndPersist(url)
  }

  // ── Filter ──────────────────────────────────────────────
  function applyFilter(name: string, value: string) {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set(`filter[${name}]`, value)
    else url.searchParams.delete(`filter[${name}]`)
    url.searchParams.delete('page')
    navigateAndPersist(url)
  }

  // ── Selection helpers ──────────────────────────────────
  const allIds      = (allRecords as Array<{ id: string }>).map((r) => r.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.includes(id))

  function toggleAll(checked: boolean) {
    setSelected(checked ? allIds : [])
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) =>
      checked ? [...prev, id] : prev.filter((x) => x !== id),
    )
  }

  // ── Bulk action handler ────────────────────────────────
  async function runAction(action: typeof resourceMeta.actions[0]) {
    if (action.requiresConfirm) {
      const selectedRecords = (records as Array<{ id: string }>).filter((r) => selected.includes(r.id))
      setConfirm({ action, records: selectedRecords })
      return
    }
    await executeAction(action)
  }

  async function executeAction(action: typeof resourceMeta.actions[0], ids?: string[]) {
    setActionPending(true)
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/_action/${action.name}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: ids ?? selected }),
      })
      if (res.ok) {
        toast.success('Action completed successfully.')
      } else {
        toast.error('Action failed. Please try again.')
      }
      setSelected([])
      window.location.reload()
    } catch {
      toast.error('Action failed. Please try again.')
    } finally {
      setActionPending(false)
      setConfirm(null)
    }
  }

  async function handleBulkDelete() {
    setBulkDeletePending(true)
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: selected }),
      })
      if (res.ok) {
        toast.success(t(i18n.bulkDeletedToast, { n: selected.length }))
        setSelected([])
        window.location.reload()
      } else {
        toast.error(i18n.deleteError)
      }
    } catch {
      toast.error(i18n.deleteError)
    } finally {
      setBulkDeletePending(false)
      setBulkDeleteConfirmOpen(false)
    }
  }

  // ── Pagination ─────────────────────────────────────────
  function goToPage(p: number) {
    const url = new URL(window.location.href)
    url.searchParams.set('page', String(p))
    void navigate(url.pathname + url.search)
  }

  const bulkActions = resourceMeta.actions.filter((a) => a.bulk)
  const rowActions  = resourceMeta.actions.filter((a) => a.row)

  return (
    <>

      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className="text-xl font-semibold">{resourceMeta.label}</h1>
          {pagination && (
            <p className="text-sm text-muted-foreground mt-0.5">{t(i18n.records, { n: pagination.total })}</p>
          )}
        </div>
        <a
          href={`/${pathSegment}/${slug}/create`}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity shrink-0"
        >
          {t(i18n.newButton, { label: resourceMeta.labelSingular })}
        </a>
      </div>

      {/* ── Toolbar (search + filters) ─────────────────────── */}
      {(hasSearch || hasFilters) && (
        <div className="flex flex-wrap items-center gap-3 mb-4">

          {/* Search */}
          {hasSearch && (
            <form onSubmit={applySearch} className="flex gap-2">
              <input
                ref={searchRef}
                type="search"
                name="search"
                defaultValue={currentSearch}
                placeholder={t(i18n.search, { label: resourceMeta.label.toLowerCase() })}
                className="h-9 px-3 text-sm rounded-md border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-w-[220px]"
              />
              <button
                type="submit"
                className="h-9 px-3 text-sm rounded-md border bg-background hover:bg-accent transition-colors"
              >
                {i18n.searchButton}
              </button>
            </form>
          )}

          {/* Select filters */}
          {resourceMeta.filters.map((filter) => {
            if (filter.type !== 'select') return null
            const options = (filter.extra['options'] ?? []) as Array<{ label: string; value: string | number | boolean }>
            const current = urlParams.get(`filter[${filter.name}]`) ?? ''
            return (
              <select
                key={filter.name}
                value={current}
                onChange={(e) => applyFilter(filter.name, e.target.value)}
                className="h-9 px-3 text-sm rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">{filter.label}</option>
                {options.map((o) => (
                  <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                ))}
              </select>
            )
          })}

          {/* Clear filters link */}
          {(currentSearch || resourceMeta.filters.some(f => urlParams.has(`filter[${f.name}]`))) && (
            <a
              href={`/${pathSegment}/${slug}`}
              onClick={(e) => {
                e.preventDefault()
                if (persist) sessionStorage.removeItem(storageKey)
                void navigate(`/${pathSegment}/${slug}`)
              }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {i18n.clearFilters}
            </a>
          )}

        </div>
      )}

      {/* ── Bulk action bar ────────────────────────────────── */}
      {selected.length > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-sm font-medium">{t(i18n.selected, { n: selected.length })}</span>
          <div className="flex gap-2">
            {bulkActions.map((action) => (
              <button
                key={action.name}
                onClick={() => runAction(action)}
                disabled={actionPending || bulkDeletePending}
                className={[
                  'px-3 py-1 text-sm rounded-md font-medium transition-colors disabled:opacity-50',
                  action.destructive
                    ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                    : 'bg-primary/10 text-primary hover:bg-primary/20',
                ].join(' ')}
              >
                {action.label}
              </button>
            ))}
            <button
              onClick={() => setBulkDeleteConfirmOpen(true)}
              disabled={actionPending || bulkDeletePending}
              className="px-3 py-1 text-sm rounded-md font-medium transition-colors disabled:opacity-50 bg-destructive/10 text-destructive hover:bg-destructive/20"
            >
              {bulkDeletePending ? i18n.loading : t(i18n.deleteSelected, { n: selected.length })}
            </button>
          </div>
          <button
            onClick={() => setSelected([])}
            className="ms-auto text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {i18n.clearSelection}
          </button>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────── */}
      <div className="rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-10 px-4 py-3">
                <Checkbox.Root
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  className="h-4 w-4 rounded border-2 border-input bg-background flex items-center justify-center data-[checked]:bg-primary data-[checked]:border-primary focus:outline-none cursor-pointer"
                >
                  <Checkbox.Indicator className="text-primary-foreground">
                    <MiniCheckIcon />
                  </Checkbox.Indicator>
                </Checkbox.Root>
              </TableHead>
              {tableFields.map((f) => {
                const sortable = sortFields.some(s => s.name === f.name)
                const isSorted = currentSort === f.name
                return (
                  <TableHead
                    key={f.name}
                    className={[
                      'px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide',
                      sortable ? 'cursor-pointer select-none hover:text-foreground transition-colors' : '',
                    ].join(' ')}
                    onClick={sortable ? () => toggleSort(f.name) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {f.label}
                      {sortable && (
                        <SortIcon active={isSorted} dir={currentDir as 'ASC' | 'DESC'} />
                      )}
                    </span>
                  </TableHead>
                )
              })}
              <TableHead className="px-4 py-3 text-end text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {i18n.actions}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {needsRestore ? (
              <TableRow><TableCell colSpan={tableFields.length + 2} className="px-6 py-12 text-center text-muted-foreground text-sm">Loading…</TableCell></TableRow>
            ) : (<>
            {(allRecords as Array<Record<string, unknown>>).map((record) => {
              const id       = record['id'] as string
              const isChecked = selected.includes(id)
              return (
                <TableRow
                  key={id}
                  className={['transition-colors hover:bg-muted/30', isChecked ? 'bg-primary/5' : ''].join(' ')}
                >
                  <TableCell className="px-4 py-3">
                    <Checkbox.Root
                      checked={isChecked}
                      onCheckedChange={(checked) => toggleOne(id, !!checked)}
                      className="h-4 w-4 rounded border-2 border-input bg-background flex items-center justify-center data-[checked]:bg-primary data-[checked]:border-primary focus:outline-none cursor-pointer"
                    >
                      <Checkbox.Indicator className="text-primary-foreground">
                        <MiniCheckIcon />
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                  </TableCell>
                  {tableFields.map((f, fi) => (
                    <TableCell key={f.name} className="px-4 py-3 text-foreground">
                      {fi === 0
                        ? (
                          <a
                            href={`/${pathSegment}/${slug}/${id}`}
                            className="font-medium hover:text-primary transition-colors"
                          >
                            <CellValue value={resolveCellValue(record, f)} type={f.type} extra={f.extra} displayTransformed={f.displayTransformed} pathSegment={pathSegment} i18n={i18n} />
                          </a>
                        )
                        : <CellValue value={resolveCellValue(record, f)} type={f.type} extra={f.extra} displayTransformed={f.displayTransformed} pathSegment={pathSegment} i18n={i18n} />
                      }
                    </TableCell>
                  ))}
                  <TableCell className="px-4 py-3 text-end">
                    <div className="flex items-center justify-end gap-2">
                      {rowActions.map((action) => (
                        <Tooltip key={action.name}>
                          <TooltipTrigger
                            onClick={() => {
                              if (action.requiresConfirm) {
                                setConfirm({ action, records: [(record as { id: string })] })
                              } else {
                                void executeAction(action, [id])
                              }
                            }}
                            className={[
                              'px-2 py-1 rounded text-xs font-medium transition-colors',
                              action.destructive
                                ? 'text-destructive hover:bg-destructive/10'
                                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                            ].join(' ')}
                          >
                            {action.icon && <span className="me-1">{action.icon}</span>}
                            {action.label}
                          </TooltipTrigger>
                          <TooltipContent>{action.label}</TooltipContent>
                        </Tooltip>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const back = window.location.pathname + window.location.search
                          void navigate(`/${pathSegment}/${slug}/${id}/edit?back=${encodeURIComponent(back)}`)
                        }}
                        className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                      >
                        {i18n.edit}
                      </button>
                      <DuplicateRowButton
                        slug={slug}
                        id={id}
                        pathSegment={pathSegment}
                        schema={allFields}
                        i18n={i18n}
                      />
                      <DeleteRowButton slug={slug} id={id} pathSegment={pathSegment} labelSingular={resourceMeta.labelSingular} i18n={i18n} />
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {allRecords.length === 0 && (
              <TableRow>
                <TableCell colSpan={tableFields.length + 2} className="py-16 text-center">
                  {hasActiveFilters
                    ? (
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-2xl">🔍</span>
                        <p className="text-sm font-medium">{i18n.noResultsTitle}</p>
                        <p className="text-sm text-muted-foreground">{i18n.noResultsHint}</p>
                      </div>
                    )
                    : (
                      <div className="flex flex-col items-center gap-3">
                        <span className="text-3xl">📭</span>
                        <p className="text-sm font-medium">{t(i18n.noRecordsTitle, { label: resourceMeta.label })}</p>
                        <a
                          href={`/${pathSegment}/${slug}/create`}
                          className="text-sm text-primary hover:underline"
                        >
                          {t(i18n.createFirstLink, { singular: resourceMeta.labelSingular })}
                        </a>
                      </div>
                    )
                  }
                </TableCell>
              </TableRow>
            )}
            </>)}
          </TableBody>
        </Table>
      </div>

      {/* ── Pagination ────────────────────────────────────── */}
      {pagination && isLoadMore && (
        <div className="flex flex-col items-center gap-2 mt-4">
          <p className="text-sm text-muted-foreground">
            {t(i18n.showing, { n: allRecords.length, total: pagination.total })}
          </p>
          {hasMorePages && (
            <button
              onClick={handleLoadMore}
              disabled={loadMorePending}
              className="px-6 py-2 text-sm font-medium rounded-md border border-border bg-background hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
            >
              {loadMorePending ? i18n.loading : i18n.loadMore}
            </button>
          )}
        </div>
      )}
      {pagination && !isLoadMore && (
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {pagination.lastPage > 1
                ? t(i18n.page, { current: pagination.currentPage, last: pagination.lastPage })
                : t(i18n.records, { n: pagination.total })}
            </p>
            {/* Per-page selector */}
            <select
              value={pagination.perPage}
              onChange={(e) => {
                const url = new URL(window.location.href)
                url.searchParams.set('perPage', e.target.value)
                url.searchParams.delete('page')
                void navigate(url.pathname + url.search)
              }}
              className="text-sm border border-input rounded-md px-2 py-1 bg-background"
            >
              {resourceMeta.perPageOptions.map((n) => (
                <option key={n} value={n}>{t(i18n.perPage, { n })}</option>
              ))}
            </select>
          </div>
          {pagination.lastPage > 1 && (
            <div className="flex gap-1">
              {Array.from({ length: pagination.lastPage }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  className={[
                    'w-8 h-8 text-sm rounded-md transition-colors',
                    p === pagination.currentPage
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  ].join(' ')}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Confirm dialog ────────────────────────────────── */}
      {confirm && (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          onConfirm={() => executeAction(confirm.action)}
          title={confirm.action.label}
          message={confirm.action.confirmMessage ?? i18n.areYouSure}
          danger={confirm.action.destructive}
          confirmLabel={i18n.confirm}
          cancelLabel={i18n.cancel}
        />
      )}
      {bulkDeleteConfirmOpen && (
        <ConfirmDialog
          open
          onClose={() => setBulkDeleteConfirmOpen(false)}
          onConfirm={handleBulkDelete}
          title={t(i18n.deleteSelected, { n: selected.length })}
          message={t(i18n.bulkDeleteConfirm, { n: selected.length })}
          danger
          confirmLabel={i18n.confirm}
          cancelLabel={i18n.cancel}
        />
      )}
    </>
  )
}

// ── Helpers ────────────────────────────────────────────────

/** For belongsTo fields, resolve the included relation object instead of raw FK value. */
function resolveCellValue(record: Record<string, unknown>, f: { name: string; type: string; extra?: Record<string, unknown> }): unknown {
  if (f.type === 'belongsTo') {
    const rel = (f.extra?.['relationName'] as string) ?? (f.name.endsWith('Id') ? f.name.slice(0, -2) : f.name)
    return record[rel]
  }
  return record[f.name]
}

// ── Sub-components ─────────────────────────────────────────

function CellValue({ value, type, extra, displayTransformed, pathSegment, i18n }: { value: unknown; type: string; extra?: Record<string, unknown>; displayTransformed?: boolean; pathSegment?: string; i18n: PanelI18n }) {
  // If server already formatted this value, render as plain text
  if (displayTransformed) {
    return <span>{String(value ?? '')}</span>
  }
  if (type === 'belongsTo') {
    const displayField  = (extra?.['displayField'] as string) ?? 'name'
    const targetResource = extra?.['resource'] as string | undefined
    const related = value as Record<string, unknown> | null | undefined
    if (related && typeof related === 'object') {
      const label = String(related[displayField] ?? '—')
      return (targetResource && pathSegment && related['id'])
        ? <a href={`/${pathSegment}/${targetResource}/${related['id']}`} className="text-primary hover:underline">{label}</a>
        : <span>{label}</span>
    }
    return <span className="text-muted-foreground/40">—</span>
  }
  if (value === null || value === undefined) return <span className="text-muted-foreground/40">—</span>
  if (type === 'boolean' || type === 'toggle') {
    return <Badge variant={value ? 'default' : 'secondary'}>{value ? i18n.yes : i18n.no}</Badge>
  }
  if (type === 'date' || type === 'datetime') {
    return <span className="text-muted-foreground">{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value as string))}</span>
  }
  if (type === 'color') {
    return (
      <span className="flex items-center gap-2">
        <span
          className="inline-block h-4 w-4 rounded-full border"
          style={{ backgroundColor: String(value) }}
        />
        <span className="font-mono text-xs">{String(value)}</span>
      </span>
    )
  }
  if (type === 'tags') {
    const tags: string[] = Array.isArray(value) ? (value as string[])
      : typeof value === 'string' && value ? (() => { try { return JSON.parse(value) } catch { return value.split(',') } })()
      : []
    if (!tags.length) return <span className="text-muted-foreground/40">—</span>
    return (
      <span className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline">{tag}</Badge>
        ))}
      </span>
    )
  }
  if (type === 'json' || type === 'repeater' || type === 'builder') {
    return <span className="text-xs text-muted-foreground font-mono">[JSON]</span>
  }
  if (type === 'image') {
    const src = String(value)
    if (!src) return <span className="text-muted-foreground/40">—</span>
    return (
      <img
        src={src}
        alt=""
        className="h-10 w-16 object-cover rounded"
      />
    )
  }
  if (type === 'file') {
    const url = String(value)
    const name = url.split('/').pop() ?? url
    return <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary underline underline-offset-2 truncate max-w-[12rem] block">{name}</a>
  }
  return <span>{String(value)}</span>
}

function SortIcon({ active, dir }: { active: boolean; dir: 'ASC' | 'DESC' }) {
  return (
    <svg
      width="10" height="12" viewBox="0 0 10 12" fill="none"
      className={active ? 'opacity-100' : 'opacity-30'}
    >
      {/* Up arrow */}
      <path
        d="M5 1L2 4h6L5 1Z"
        fill="currentColor"
        opacity={!active || dir === 'ASC' ? 1 : 0.3}
      />
      {/* Down arrow */}
      <path
        d="M5 11L2 8h6L5 11Z"
        fill="currentColor"
        opacity={!active || dir === 'DESC' ? 1 : 0.3}
      />
    </svg>
  )
}

function DeleteRowButton({ slug, id, pathSegment, labelSingular, i18n }: { slug: string; id: string; pathSegment: string; labelSingular: string; i18n: PanelI18n }) {
  const [open, setOpen] = useState(false)

  async function handleDelete() {
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success(t(i18n.deletedToast, { label: labelSingular }))
      } else {
        toast.error(i18n.deleteError)
      }
    } catch {
      toast.error(i18n.deleteError)
    }
    setOpen(false)
    window.location.reload()
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-2.5 py-1 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
      >
        {i18n.deleteRecord}
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleDelete}
        title={i18n.deleteRecord}
        message={i18n.deleteConfirm}
        danger
        confirmLabel={i18n.confirm}
        cancelLabel={i18n.cancel}
      />
    </>
  )
}

function MiniCheckIcon() {
  return (
    <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
      <path d="M1 3.5L3 5.5L8 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DuplicateRowButton({ slug, id, pathSegment, schema, i18n }: {
  slug:        string
  id:          string
  pathSegment: string
  schema:      FieldMeta[]
  i18n:        PanelI18n
}) {
  const [loading, setLoading] = useState(false)

  async function handleDuplicate() {
    setLoading(true)
    try {
      const res  = await fetch(`/${pathSegment}/api/${slug}/${id}`)
      if (!res.ok) { toast.error(i18n.deleteError); return }
      const body = await res.json() as { data: Record<string, unknown> }
      const record = body.data

      const params = new URLSearchParams()

      // Determine which fields auto-generate a slug, so we can suffix their value with " (copy)"
      const slugSourceFields = new Set(
        schema.filter((f) => f.type === 'slug' && f.extra?.['from']).map((f) => String(f.extra?.['from']))
      )

      for (const field of schema) {
        if (field.hidden.includes('create')) continue
        if (field.readonly) continue
        if (field.name === 'id') continue
        if (field.type === 'password' || field.type === 'hidden' || field.type === 'slug') continue

        let val = record[field.name]
        if (val === null || val === undefined) continue

        // Append " (copy)" so the auto-generated slug won't collide with the original
        if (slugSourceFields.has(field.name) && typeof val === 'string') val = `${val} (copy)`

        if (field.type === 'belongsToMany') {
          const items = Array.isArray(val) ? (val as Array<{ id?: string }>) : []
          const ids   = items.map(r => r.id ?? String(r)).filter(Boolean)
          if (ids.length > 0) params.set(`prefill[${field.name}]`, ids.join(','))
        } else if (field.type === 'boolean' || field.type === 'toggle') {
          params.set(`prefill[${field.name}]`, val ? 'true' : 'false')
        } else if (typeof val === 'object') {
          params.set(`prefill[${field.name}]`, JSON.stringify(val))
        } else {
          params.set(`prefill[${field.name}]`, String(val))
        }
      }

      const back = window.location.pathname + window.location.search
      params.set('back', back)

      void navigate(`/${pathSegment}/${slug}/create?${params.toString()}`)
    } catch {
      toast.error(i18n.deleteError)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleDuplicate}
      disabled={loading}
      className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
    >
      {loading ? i18n.loading : i18n.duplicate}
    </button>
  )
}
