'use client'

import { useState } from 'react'
import { useData } from 'vike-react/useData'
import { Checkbox } from '@base-ui-components/react/checkbox'
import { Menu } from '@base-ui-components/react/menu'
import { AdminLayout } from '../../_components/AdminLayout.js'
import { ConfirmDialog } from '../../_components/ConfirmDialog.js'
import type { Data } from './+data.js'

export default function ResourceListPage() {
  const { panelMeta, resourceMeta, records, pagination, pathSegment, slug } = useData<Data>()

  const [selected,       setSelected]       = useState<string[]>([])
  const [confirm,        setConfirm]        = useState<{ action: typeof resourceMeta.actions[0]; records: unknown[] } | null>(null)
  const [actionPending,  setActionPending]  = useState(false)

  const tableFields = resourceMeta.fields.filter((f) => !f.hidden.includes('table'))

  // ── Selection helpers ──────────────────────────────────
  const allIds   = (records as Array<{ id: string }>).map((r) => r.id)
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

  async function executeAction(action: typeof resourceMeta.actions[0]) {
    setActionPending(true)
    try {
      await fetch(`/${pathSegment}/api/${slug}/_action/${action.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected }),
      })
      setSelected([])
      window.location.reload()
    } finally {
      setActionPending(false)
      setConfirm(null)
    }
  }

  // ── Pagination ─────────────────────────────────────────
  function goToPage(p: number) {
    const url = new URL(window.location.href)
    url.searchParams.set('page', String(p))
    window.location.href = url.toString()
  }

  const bulkActions = resourceMeta.actions.filter((a) => a.bulk)

  return (
    <AdminLayout panelMeta={panelMeta} currentSlug={slug}>

      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{resourceMeta.label}</h1>
          {pagination && (
            <p className="text-sm text-slate-500 mt-0.5">{pagination.total} records</p>
          )}
        </div>
        <a
          href={`/${pathSegment}/${slug}/create`}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
        >
          <span>+</span> New {resourceMeta.labelSingular}
        </a>
      </div>

      {/* ── Bulk action bar ───────────────────────────────── */}
      {selected.length > 0 && bulkActions.length > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-indigo-50 border border-indigo-200 rounded-lg">
          <span className="text-sm text-indigo-700 font-medium">
            {selected.length} selected
          </span>
          <div className="flex gap-2">
            {bulkActions.map((action) => (
              <button
                key={action.name}
                onClick={() => runAction(action)}
                disabled={actionPending}
                className={[
                  'px-3 py-1 text-sm rounded-md font-medium transition-colors disabled:opacity-50',
                  action.destructive
                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200',
                ].join(' ')}
              >
                {action.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSelected([])}
            className="ml-auto text-sm text-slate-500 hover:text-slate-700"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="w-10 px-4 py-3">
                <Checkbox.Root
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  className="h-4 w-4 rounded border-2 border-slate-300 bg-white flex items-center justify-center data-[checked]:bg-indigo-600 data-[checked]:border-indigo-600 focus:outline-none cursor-pointer"
                >
                  <Checkbox.Indicator className="text-white">
                    <MiniCheckIcon />
                  </Checkbox.Indicator>
                </Checkbox.Root>
              </th>
              {tableFields.map((f) => (
                <th key={f.name} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {f.label}
                </th>
              ))}
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(records as Array<Record<string, unknown>>).map((record) => {
              const id       = record['id'] as string
              const isChecked = selected.includes(id)
              return (
                <tr key={id} className={`hover:bg-slate-50 transition-colors ${isChecked ? 'bg-indigo-50/50' : ''}`}>
                  <td className="px-4 py-3">
                    <Checkbox.Root
                      checked={isChecked}
                      onCheckedChange={(checked) => toggleOne(id, !!checked)}
                      className="h-4 w-4 rounded border-2 border-slate-300 bg-white flex items-center justify-center data-[checked]:bg-indigo-600 data-[checked]:border-indigo-600 focus:outline-none cursor-pointer"
                    >
                      <Checkbox.Indicator className="text-white">
                        <MiniCheckIcon />
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                  </td>
                  {tableFields.map((f) => (
                    <td key={f.name} className="px-4 py-3 text-slate-700">
                      <CellValue value={record[f.name]} type={f.type} />
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <a
                        href={`/${pathSegment}/${slug}/${id}/edit`}
                        className="text-xs px-2.5 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
                      >
                        Edit
                      </a>
                      <DeleteRowButton slug={slug} id={id} pathSegment={pathSegment} />
                    </div>
                  </td>
                </tr>
              )
            })}
            {records.length === 0 && (
              <tr>
                <td colSpan={tableFields.length + 2} className="px-4 py-12 text-center text-slate-400">
                  No records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ────────────────────────────────────── */}
      {pagination && pagination.lastPage > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-slate-500">
            Page {pagination.currentPage} of {pagination.lastPage}
          </p>
          <div className="flex gap-1">
            {Array.from({ length: pagination.lastPage }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => goToPage(p)}
                className={[
                  'w-8 h-8 text-sm rounded-md transition-colors',
                  p === pagination.currentPage
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-200 text-slate-600 hover:bg-slate-50',
                ].join(' ')}
              >
                {p}
              </button>
            ))}
          </div>
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
  if (value === null || value === undefined) return <span className="text-slate-300">—</span>
  if (type === 'boolean') {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${value ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
        {value ? 'Yes' : 'No'}
      </span>
    )
  }
  if (type === 'date' || type === 'datetime') {
    return <span className="text-slate-500">{new Date(value as string).toLocaleDateString()}</span>
  }
  return <span>{String(value)}</span>
}

function DeleteRowButton({ slug, id, pathSegment }: { slug: string; id: string; pathSegment: string }) {
  const [open, setOpen] = useState(false)

  async function handleDelete() {
    await fetch(`/${pathSegment}/api/${slug}/${id}`, { method: 'DELETE' })
    setOpen(false)
    window.location.reload()
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-2.5 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
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
