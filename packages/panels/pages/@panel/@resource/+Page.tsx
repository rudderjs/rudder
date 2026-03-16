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
import { CellValue, resolveCellValue } from '../../_components/CellValue.js'
import { ResourceIcon } from '../../_components/ResourceIcon.js'
import { InlineEditCell } from '../../_components/InlineEditCell.js'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip.js'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.js'
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
  const hasSoftDeletes = (resourceMeta as any).softDeletes === true

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
  // Exclude trashed param from persistence — trash toggle is a view switch, not a filter to restore
  if (persist && typeof window !== 'undefined' && urlSearch && !(isLoadMore && extraRecords.length > 0)) {
    const persistParams = new URLSearchParams(urlSearch)
    persistParams.delete('trashed')
    persistParams.delete('draft')
    const cleanSearch = persistParams.toString()
    if (cleanSearch) {
      sessionStorage.setItem(storageKey, '?' + cleanSearch)
    } else {
      sessionStorage.removeItem(storageKey)
    }
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
  const isTrashed     = urlParams.get('trashed') === 'true'
  const draftFilter   = urlParams.get('draft') // 'true' | 'false' | null (all)
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

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSearchInput(value: string) {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      const url = new URL(window.location.href)
      if (value.trim()) url.searchParams.set('search', value.trim())
      else url.searchParams.delete('search')
      url.searchParams.delete('page')
      navigateAndPersist(url)
    }, 350)
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
      void navigate(window.location.pathname + window.location.search, { overwriteLastHistoryEntry: true })
    } catch {
      toast.error('Action failed. Please try again.')
    } finally {
      setActionPending(false)
      setConfirm(null)
    }
  }

  async function handleBulkRestore() {
    setBulkDeletePending(true)
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/_restore`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: selected }),
      })
      if (res.ok) {
        toast.success((i18n as any).restoredRecordToast)
        setSelected([])
        void navigate(window.location.pathname + window.location.search, { overwriteLastHistoryEntry: true })
      } else {
        toast.error((i18n as any).restoreError ?? 'Failed to restore.')
      }
    } catch {
      toast.error((i18n as any).restoreError ?? 'Failed to restore.')
    } finally {
      setBulkDeletePending(false)
    }
  }

  async function handleBulkForceDelete() {
    setBulkDeletePending(true)
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/_force`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: selected }),
      })
      if (res.ok) {
        toast.success((i18n as any).forceDeletedToast)
        setSelected([])
        void navigate(window.location.pathname + window.location.search, { overwriteLastHistoryEntry: true })
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
        void navigate(window.location.pathname + window.location.search, { overwriteLastHistoryEntry: true })
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
          <h1 className="text-xl font-semibold">
            {resourceMeta.label}
            {isTrashed && <span className="text-muted-foreground ms-2 text-base font-normal">— {(i18n as any).trash}</span>}
          </h1>
          {pagination && (
            <p className="text-sm text-muted-foreground mt-0.5">{t(i18n.records, { n: pagination.total })}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasSoftDeletes && (
            <a
              href={isTrashed ? `/${pathSegment}/${slug}` : `/${pathSegment}/${slug}?trashed=true`}
              className={[
                'inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border transition-colors shrink-0',
                isTrashed
                  ? 'border-primary text-primary bg-primary/10 hover:bg-primary/20'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              ].join(' ')}
            >
              {isTrashed ? (i18n as any).exitTrash : (i18n as any).viewTrash}
            </a>
          )}
          {!isTrashed && (resourceMeta as any).draftable ? (
            <CreateDraftButton slug={slug} pathSegment={pathSegment} labelSingular={resourceMeta.labelSingular} i18n={i18n} />
          ) : !isTrashed ? (
            <a
              href={`/${pathSegment}/${slug}/create`}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity shrink-0"
            >
              {t(i18n.newButton, { label: resourceMeta.labelSingular })}
            </a>
          ) : null}
        </div>
      </div>

      {/* ── Trashed banner ─────────────────────────────────── */}
      {isTrashed && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-700 dark:text-amber-400">
          {(i18n as any).trashedBanner}
        </div>
      )}

      {/* ── Draft filter tabs ──────────────────────────────── */}
      {hasSoftDeletes && !isTrashed && (resourceMeta as any).draftable && (
        <div className="flex items-center gap-1 mb-4">
          {([
            { key: null,    label: i18n.all ?? 'All' },
            { key: 'true',  label: (i18n as any).draft ?? 'Draft' },
            { key: 'false', label: (i18n as any).published ?? 'Published' },
          ] as { key: string | null; label: string }[]).map(({ key, label }) => (
            <a
              key={key ?? 'all'}
              href={`/${pathSegment}/${slug}${key !== null ? `?draft=${key}` : ''}`}
              className={[
                'px-3 py-1.5 text-sm rounded-md transition-colors',
                draftFilter === key || (key === null && draftFilter === null)
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              ].join(' ')}
            >
              {label}
            </a>
          ))}
        </div>
      )}

      {/* ── Toolbar (search + filters) ─────────────────────── */}
      {(hasSearch || hasFilters) && (
        <div className="flex flex-wrap items-center gap-3 mb-4">

          {/* Search */}
          {hasSearch && (
            <div className="relative group">
              <ResourceIcon icon="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                name="search"
                defaultValue={currentSearch}
                placeholder={t(i18n.search, { label: resourceMeta.label.toLowerCase() })}
                onChange={(e) => handleSearchInput(e.currentTarget.value)}
                className="h-9 pl-8 pr-8 text-sm rounded-md border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-w-[220px]"
              />
              {currentSearch && (
                <button
                  type="button"
                  onClick={() => {
                    if (searchRef.current) searchRef.current.value = ''
                    handleSearchInput('')
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ResourceIcon icon="x" className="size-4" />
                </button>
              )}
            </div>
          )}

          {/* Select filters */}
          {resourceMeta.filters.map((filter) => {
            if (filter.type !== 'select') return null
            const options = (filter.extra['options'] ?? []) as Array<{ label: string; value: string | number | boolean }>
            const current = urlParams.get(`filter[${filter.name}]`) ?? ''
            return (
              <Select
                key={filter.name}
                value={current || null}
                onValueChange={(val) => applyFilter(filter.name, val ?? '')}
              >
                <SelectTrigger>
                  <SelectValue placeholder={filter.label} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{filter.label}</SelectItem>
                  {options.map((o) => (
                    <SelectItem key={String(o.value)} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            {isTrashed ? (
              <>
                <button
                  onClick={handleBulkRestore}
                  disabled={actionPending || bulkDeletePending}
                  className="px-3 py-1 text-sm rounded-md font-medium transition-colors disabled:opacity-50 bg-primary/10 text-primary hover:bg-primary/20"
                >
                  {bulkDeletePending ? i18n.loading : (i18n as any).bulkRestore}
                </button>
                <button
                  onClick={() => setBulkDeleteConfirmOpen(true)}
                  disabled={actionPending || bulkDeletePending}
                  className="px-3 py-1 text-sm rounded-md font-medium transition-colors disabled:opacity-50 bg-destructive/10 text-destructive hover:bg-destructive/20"
                >
                  {bulkDeletePending ? i18n.loading : (i18n as any).bulkForceDelete}
                </button>
              </>
            ) : (
              <button
                onClick={() => setBulkDeleteConfirmOpen(true)}
                disabled={actionPending || bulkDeletePending}
                className="px-3 py-1 text-sm rounded-md font-medium transition-colors disabled:opacity-50 bg-destructive/10 text-destructive hover:bg-destructive/20"
              >
                {bulkDeletePending ? i18n.loading : t(i18n.deleteSelected, { n: selected.length })}
              </button>
            )}
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
                          <span className="inline-flex items-center gap-2">
                            <a
                              href={`/${pathSegment}/${slug}/${id}`}
                              className="font-medium hover:text-primary transition-colors"
                            >
                              <CellValue value={resolveCellValue(record, f)} type={f.type} extra={f.extra} displayTransformed={f.displayTransformed} pathSegment={pathSegment} i18n={i18n} />
                            </a>
                            {(resourceMeta as any).draftable && record['draftStatus'] === 'draft' && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                {(i18n as any).draft ?? 'Draft'}
                              </span>
                            )}
                          </span>
                        )
                        : f.extra?.['inlineEditable'] && !isTrashed
                          ? <InlineEditCell record={record} field={f} slug={slug} pathSegment={pathSegment} i18n={i18n} />
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
                      {isTrashed ? (
                        <>
                          <RestoreRowButton slug={slug} id={id} pathSegment={pathSegment} i18n={i18n} />
                          <ForceDeleteRowButton slug={slug} id={id} pathSegment={pathSegment} i18n={i18n} />
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
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
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
                          <ResourceIcon icon="search" className="size-6 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-medium">{i18n.noResultsTitle}</p>
                        <p className="text-sm text-muted-foreground">{i18n.noResultsHint}</p>
                      </div>
                    )
                    : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
                          <ResourceIcon icon={resourceMeta.emptyStateIcon ?? resourceMeta.icon} className="size-6 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-medium">
                          {resourceMeta.emptyStateHeading
                            ? t(resourceMeta.emptyStateHeading, { label: resourceMeta.label })
                            : t(i18n.noRecordsTitle, { label: resourceMeta.label })}
                        </p>
                        {resourceMeta.emptyStateDescription && (
                          <p className="text-sm text-muted-foreground">{resourceMeta.emptyStateDescription}</p>
                        )}
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
            <Select
              value={String(pagination.perPage)}
              onValueChange={(val) => {
                if (!val) return
                const url = new URL(window.location.href)
                url.searchParams.set('perPage', val)
                url.searchParams.delete('page')
                void navigate(url.pathname + url.search)
              }}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {resourceMeta.perPageOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>{t(i18n.perPage, { n })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          onConfirm={isTrashed ? handleBulkForceDelete : handleBulkDelete}
          title={isTrashed ? (i18n as any).forceDelete : t(i18n.deleteSelected, { n: selected.length })}
          message={isTrashed ? (i18n as any).forceDeleteConfirm : t(i18n.bulkDeleteConfirm, { n: selected.length })}
          danger
          confirmLabel={i18n.confirm}
          cancelLabel={i18n.cancel}
        />
      )}
    </>
  )
}

// ── Sub-components ─────────────────────────────────────────

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
    void navigate(window.location.pathname + window.location.search, { overwriteLastHistoryEntry: true })
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

function RestoreRowButton({ slug, id, pathSegment, i18n }: { slug: string; id: string; pathSegment: string; i18n: PanelI18n }) {
  const [pending, setPending] = useState(false)

  async function handleRestore() {
    setPending(true)
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/${id}/_restore`, { method: 'POST' })
      if (res.ok) {
        toast.success((i18n as any).restoredRecordToast)
      } else {
        toast.error((i18n as any).restoreError ?? 'Failed to restore.')
      }
    } catch {
      toast.error((i18n as any).restoreError ?? 'Failed to restore.')
    }
    setPending(false)
    void navigate(window.location.pathname + window.location.search, { overwriteLastHistoryEntry: true })
  }

  return (
    <button
      onClick={handleRestore}
      disabled={pending}
      className="text-xs px-2.5 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
    >
      {(i18n as any).restoreRecord}
    </button>
  )
}

function ForceDeleteRowButton({ slug, id, pathSegment, i18n }: { slug: string; id: string; pathSegment: string; i18n: PanelI18n }) {
  const [open, setOpen] = useState(false)

  async function handleForceDelete() {
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/${id}/_force`, { method: 'DELETE' })
      if (res.ok) {
        toast.success((i18n as any).forceDeletedToast)
      } else {
        toast.error(i18n.deleteError)
      }
    } catch {
      toast.error(i18n.deleteError)
    }
    setOpen(false)
    void navigate(window.location.pathname + window.location.search, { overwriteLastHistoryEntry: true })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-2.5 py-1 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
      >
        {(i18n as any).forceDelete}
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleForceDelete}
        title={(i18n as any).forceDelete}
        message={(i18n as any).forceDeleteConfirm}
        danger
        confirmLabel={i18n.confirm}
        cancelLabel={i18n.cancel}
      />
    </>
  )
}

function CreateDraftButton({ slug, pathSegment, labelSingular, i18n }: {
  slug: string; pathSegment: string; labelSingular: string; i18n: PanelI18n
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
        void navigate(`/${pathSegment}/${slug}/${body.data.id}/edit`)
      } else {
        toast.error((i18n as any).saveError ?? 'Failed to create draft.')
        setCreating(false)
      }
    } catch {
      toast.error((i18n as any).saveError ?? 'Failed to create draft.')
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
      {creating ? (i18n as any).loading : t(i18n.newButton, { label: labelSingular })}
    </button>
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
