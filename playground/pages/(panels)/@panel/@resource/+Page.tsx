'use client'

import { useState, useRef } from 'react'
import { useData } from 'vike-react/useData'
import { navigate } from 'vike/client/router'
import { toast } from 'sonner'
import { Checkbox } from '@base-ui-components/react/checkbox'
import { AdminLayout } from '../../_components/AdminLayout.js'
import { ConfirmDialog } from '../../_components/ConfirmDialog.js'
import type { FieldMeta, SectionMeta, TabsMeta } from '@boostkit/panels'
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

export default function ResourceListPage() {
  const { panelMeta, resourceMeta, records, pagination, pathSegment, slug } = useData<Data>()

  const [selected,       setSelected]       = useState<string[]>([])
  const [confirm,        setConfirm]        = useState<{ action: typeof resourceMeta.actions[0]; records: unknown[] } | null>(null)
  const [actionPending,  setActionPending]  = useState(false)

  const allFields    = flattenFields(resourceMeta.fields as SchemaItem[])
  const tableFields  = allFields.filter((f) => !f.hidden.includes('table'))
  const sortFields   = allFields.filter((f) => f.sortable)
  const searchFields = allFields.filter((f) => f.searchable)
  const hasSearch    = searchFields.length > 0
  const hasFilters   = resourceMeta.filters.length > 0

  // ── Current URL params ─────────────────────────────────
  const urlParams  = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
  const currentSort   = urlParams.get('sort') ?? ''
  const currentDir    = urlParams.get('dir') ?? 'ASC'
  const currentSearch = urlParams.get('search') ?? ''
  const hasActiveFilters = urlParams.has('search') || [...urlParams.keys()].some((k) => k.startsWith('filter['))

  // ── Search state ────────────────────────────────────────
  const searchRef = useRef<HTMLInputElement>(null)

  function applySearch(e: React.FormEvent) {
    e.preventDefault()
    const q   = searchRef.current?.value ?? ''
    const url = new URL(window.location.href)
    if (q) url.searchParams.set('search', q)
    else url.searchParams.delete('search')
    url.searchParams.delete('page')
    void navigate(url.pathname + url.search)
  }

  // ── Sort ────────────────────────────────────────────────
  function toggleSort(col: string) {
    const url = new URL(window.location.href)
    if (currentSort === col) {
      url.searchParams.set('dir', currentDir === 'ASC' ? 'DESC' : 'ASC')
    } else {
      url.searchParams.set('sort', col)
      url.searchParams.set('dir', 'ASC')
    }
    url.searchParams.delete('page')
    void navigate(url.pathname + url.search)
  }

  // ── Filter ──────────────────────────────────────────────
  function applyFilter(name: string, value: string) {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set(`filter[${name}]`, value)
    else url.searchParams.delete(`filter[${name}]`)
    url.searchParams.delete('page')
    void navigate(url.pathname + url.search)
  }

  // ── Selection helpers ──────────────────────────────────
  const allIds      = (records as Array<{ id: string }>).map((r) => r.id)
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

  // ── Pagination ─────────────────────────────────────────
  function goToPage(p: number) {
    const url = new URL(window.location.href)
    url.searchParams.set('page', String(p))
    void navigate(url.pathname + url.search)
  }

  const bulkActions = resourceMeta.actions.filter((a) => a.bulk)
  const rowActions  = resourceMeta.actions.filter((a) => a.row)

  return (
    <AdminLayout panelMeta={panelMeta} currentSlug={slug}>

      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className="text-xl font-semibold">{resourceMeta.label}</h1>
          {pagination && (
            <p className="text-sm text-muted-foreground mt-0.5">{pagination.total} records</p>
          )}
        </div>
        <a
          href={`/${pathSegment}/${slug}/create`}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity shrink-0"
        >
          <span aria-hidden>+</span> New {resourceMeta.labelSingular}
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
                placeholder={`Search ${resourceMeta.label.toLowerCase()}…`}
                className="h-9 px-3 text-sm rounded-md border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-w-[220px]"
              />
              <button
                type="submit"
                className="h-9 px-3 text-sm rounded-md border bg-background hover:bg-accent transition-colors"
              >
                Search
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
                <option value="">{filter.label}: All</option>
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
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear filters
            </a>
          )}

        </div>
      )}

      {/* ── Bulk action bar ────────────────────────────────── */}
      {selected.length > 0 && bulkActions.length > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-sm font-medium">{selected.length} selected</span>
          <div className="flex gap-2">
            {bulkActions.map((action) => (
              <button
                key={action.name}
                onClick={() => runAction(action)}
                disabled={actionPending}
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
          </div>
          <button
            onClick={() => setSelected([])}
            className="ml-auto text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────── */}
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="w-10 px-4 py-3">
                <Checkbox.Root
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  className="h-4 w-4 rounded border-2 border-input bg-background flex items-center justify-center data-[checked]:bg-primary data-[checked]:border-primary focus:outline-none cursor-pointer"
                >
                  <Checkbox.Indicator className="text-primary-foreground">
                    <MiniCheckIcon />
                  </Checkbox.Indicator>
                </Checkbox.Root>
              </th>
              {tableFields.map((f) => {
                const sortable = sortFields.some(s => s.name === f.name)
                const isSorted = currentSort === f.name
                return (
                  <th
                    key={f.name}
                    className={[
                      'px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide',
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
                  </th>
                )
              })}
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(records as Array<Record<string, unknown>>).map((record) => {
              const id       = record['id'] as string
              const isChecked = selected.includes(id)
              return (
                <tr
                  key={id}
                  className={['transition-colors hover:bg-muted/30', isChecked ? 'bg-primary/5' : ''].join(' ')}
                >
                  <td className="px-4 py-3">
                    <Checkbox.Root
                      checked={isChecked}
                      onCheckedChange={(checked) => toggleOne(id, !!checked)}
                      className="h-4 w-4 rounded border-2 border-input bg-background flex items-center justify-center data-[checked]:bg-primary data-[checked]:border-primary focus:outline-none cursor-pointer"
                    >
                      <Checkbox.Indicator className="text-primary-foreground">
                        <MiniCheckIcon />
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                  </td>
                  {tableFields.map((f, fi) => (
                    <td key={f.name} className="px-4 py-3 text-foreground">
                      {fi === 0
                        ? (
                          <a
                            href={`/${pathSegment}/${slug}/${id}`}
                            className="font-medium hover:text-primary transition-colors"
                          >
                            <CellValue value={record[f.name]} type={f.type} />
                          </a>
                        )
                        : <CellValue value={record[f.name]} type={f.type} />
                      }
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {rowActions.map((action) => (
                        <button
                          key={action.name}
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
                          {action.icon && <span className="mr-1">{action.icon}</span>}
                          {action.label}
                        </button>
                      ))}
                      <a
                        href={`/${pathSegment}/${slug}/${id}/edit`}
                        className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                      >
                        Edit
                      </a>
                      <DeleteRowButton slug={slug} id={id} pathSegment={pathSegment} labelSingular={resourceMeta.labelSingular} />
                    </div>
                  </td>
                </tr>
              )
            })}
            {records.length === 0 && (
              <tr>
                <td colSpan={tableFields.length + 2} className="py-16 text-center">
                  {hasActiveFilters
                    ? (
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-2xl">🔍</span>
                        <p className="text-sm font-medium">No results</p>
                        <p className="text-sm text-muted-foreground">Try adjusting your search or filters.</p>
                      </div>
                    )
                    : (
                      <div className="flex flex-col items-center gap-3">
                        <span className="text-3xl">📭</span>
                        <p className="text-sm font-medium">No {resourceMeta.label} yet</p>
                        <a
                          href={`/${pathSegment}/${slug}/create`}
                          className="text-sm text-primary hover:underline"
                        >
                          Create your first {resourceMeta.labelSingular}
                        </a>
                      </div>
                    )
                  }
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ────────────────────────────────────── */}
      {pagination && (
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {pagination.lastPage > 1 ? `Page ${pagination.currentPage} of ${pagination.lastPage}` : `${pagination.total} records`}
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
              {[10, 15, 25, 50, 100].map((n) => (
                <option key={n} value={n}>{n} / page</option>
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
          message={confirm.action.confirmMessage ?? 'Are you sure?'}
          danger={confirm.action.destructive}
        />
      )}
    </AdminLayout>
  )
}

// ── Sub-components ─────────────────────────────────────────

function CellValue({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground/40">—</span>
  if (type === 'boolean' || type === 'toggle') {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${value ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
        {value ? 'Yes' : 'No'}
      </span>
    )
  }
  if (type === 'date' || type === 'datetime') {
    return <span className="text-muted-foreground">{new Date(value as string).toLocaleDateString()}</span>
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
  if (type === 'tags' && Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1">
        {(value as string[]).map((tag) => (
          <span key={tag} className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
            {tag}
          </span>
        ))}
      </span>
    )
  }
  if (type === 'json' || type === 'repeater' || type === 'builder') {
    return <span className="text-xs text-muted-foreground font-mono">[JSON]</span>
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

function DeleteRowButton({ slug, id, pathSegment, labelSingular }: { slug: string; id: string; pathSegment: string; labelSingular: string }) {
  const [open, setOpen] = useState(false)

  async function handleDelete() {
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success(`${labelSingular} deleted.`)
      } else {
        toast.error('Failed to delete. Please try again.')
      }
    } catch {
      toast.error('Failed to delete. Please try again.')
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
        Delete
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleDelete}
        title="Delete record"
        message="This action cannot be undone."
        danger
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
