'use client'

import { useState, useCallback, useEffect, forwardRef } from 'react'
import { SortableTree } from 'dnd-kit-sortable-tree'
import type { TreeItems, TreeItemComponentProps, ItemChangedReason } from 'dnd-kit-sortable-tree'
import { ResourceIcon } from './ResourceIcon.js'

// ─── Types ──────────────────────────────────────────────────

interface DataFieldMeta {
  name:       string
  label:      string
  type:       string
  format?:    string
  href?:      string
  editable?:  boolean
  editMode?:  string
  editField?: unknown
}

interface TreeViewProps {
  records:        Record<string, unknown>[]
  folderField:    string
  titleField:     string
  iconField?:     string
  fields?:        DataFieldMeta[]
  reorderable?:   boolean
  reorderEndpoint?: string
  reorderField?:  string
  reorderModel?:  string
  onRecordsChange?: (records: Record<string, unknown>[]) => void
}

// ─── Build nested tree from flat records ────────────────────

type TreeRecord = { id: string; [key: string]: unknown }

function buildTree(records: Record<string, unknown>[], folderField: string): TreeItems<TreeRecord> {
  const map = new Map<string, TreeItems<TreeRecord>[number]>()
  const roots: TreeItems<TreeRecord> = []

  for (const r of records) {
    const id = String(r.id)
    map.set(id, { id, ...r, children: [] } as TreeItems<TreeRecord>[number])
  }

  for (const r of records) {
    const id = String(r.id)
    const parentId = r[folderField] ? String(r[folderField]) : null
    const node = map.get(id)!
    if (parentId && map.has(parentId)) {
      map.get(parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

function flattenTree(items: TreeItems<TreeRecord>, folderField: string, parentId: string | null = null): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  for (const item of items) {
    const { children, ...rest } = item
    result.push({ ...rest, [folderField]: parentId })
    if (children && children.length > 0) {
      result.push(...flattenTree(children as TreeItems<TreeRecord>, folderField, String(item.id)))
    }
  }
  return result
}

// ─── Grip Icon ──────────────────────────────────────────────

function GripIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="5" cy="3" r="1.5" /><circle cx="11" cy="3" r="1.5" />
      <circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" />
      <circle cx="5" cy="13" r="1.5" /><circle cx="11" cy="13" r="1.5" />
    </svg>
  )
}

// ─── TreeItemWrapper — our own, no library CSS ──────────────
// Same structure as SimpleTreeItemWrapper but pure Tailwind.
// Renders identical DOM to StaticTreeView for zero hydration shift.

const TreeItemWrapper = forwardRef<
  HTMLDivElement,
  React.PropsWithChildren<TreeItemComponentProps<TreeRecord>>
>((props, ref) => {
  const {
    clone, depth, ghost, handleProps, indentationWidth,
    collapsed, onCollapse, wrapperRef, style, childCount,
    disableSorting, children,
    // Consumed but not used in DOM:
    disableSelection: _, disableInteraction: _2, indicator: _3,
    onRemove: _4, item: _5, manualDrag: _6, showDragHandle: _7,
    hideCollapseButton: _8, disableCollapseOnItemClick: _9,
    isLast: _10, parent: _11, className: _12, contentClassName: _13,
    isOver: _14, isOverParent: _15,
    ...rest
  } = props

  return (
    <li
      ref={wrapperRef}
      {...rest}
      className={`list-none ${ghost ? 'opacity-30' : ''} ${clone ? 'inline-block' : ''}`}
      style={{
        ...style,
        paddingLeft: clone ? indentationWidth : (indentationWidth ?? 24) * depth,
      }}
    >
      <div
        ref={ref}
        className={[
          'flex items-center py-1.5 px-2 rounded-md border border-transparent transition-colors',
          clone ? 'bg-card border-border shadow-lg rounded-lg' : 'hover:bg-muted hover:border-border',
        ].join(' ')}
      >
        {children}
        {/* Collapse button — end of row */}
        {!!onCollapse && !!childCount && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCollapse?.() }}
            className="ml-auto border-none bg-transparent cursor-pointer p-1 text-muted-foreground/40 rounded hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <svg className={`h-3 w-3 transition-transform ${collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>
    </li>
  )
}) as <T>(
  p: React.PropsWithChildren<TreeItemComponentProps<T> & React.RefAttributes<HTMLDivElement>>
) => React.ReactElement

// ─── Tree Item Content ──────────────────────────────────────

const TreeItem = forwardRef<HTMLDivElement, TreeItemComponentProps<TreeRecord> & { titleField: string; iconField?: string; fields?: DataFieldMeta[] }>(
  function TreeItemInner(props, ref) {
    const { item, titleField, iconField, fields } = props
    const icon = iconField ? item[iconField] as string | undefined : undefined
    const title = String(item[titleField] ?? item.id)

    return (
      <TreeItemWrapper {...props} ref={ref}>
        <div className="flex items-center gap-2 py-0.5 min-w-0">
          {!props.disableSorting && (
            <span className="shrink-0 cursor-grab active:cursor-grabbing touch-none text-muted-foreground/40 hover:text-muted-foreground p-1" {...props.handleProps}>
              <GripIcon />
            </span>
          )}
          {icon && <span className="text-muted-foreground shrink-0"><ResourceIcon icon={icon} /></span>}
          <span className="text-sm font-medium truncate">{title}</span>
          {fields && fields.length > 0 && fields.map(f => {
            if (f.name === titleField) return null
            const val = item[f.name]
            if (val === null || val === undefined) return null
            if (f.type === 'badge') {
              return <span key={f.name} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-secondary text-secondary-foreground">{String(val)}</span>
            }
            return <span key={f.name} className="text-xs text-muted-foreground">{String(val)}</span>
          })}
        </div>
      </TreeItemWrapper>
    )
  }
)

// ─── TreeView Component ─────────────────────────────────────

export function TreeView({ records, folderField, titleField, iconField, fields, reorderable, reorderEndpoint, reorderField, reorderModel, onRecordsChange }: TreeViewProps) {
  const [items, setItems] = useState<TreeItems<TreeRecord>>(() =>
    buildTree(records, folderField)
  )

  const recordIds = records.map(r => String(r.id)).join(',')
  useEffect(() => {
    setItems(buildTree(records, folderField))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordIds, folderField])

  const handleItemsChanged = useCallback((newItems: TreeItems<TreeRecord>, reason: ItemChangedReason<TreeRecord>) => {
    setItems(newItems)

    if (reason.type === 'dropped' && reorderable && reorderEndpoint) {
      const flat = flattenTree(newItems, folderField)
      const ids = flat.map(r => String(r.id))
      const parents: Record<string, string | null> = {}
      for (const r of flat) {
        parents[String(r.id)] = r[folderField] ? String(r[folderField]) : null
      }
      fetch(reorderEndpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids, field: reorderField ?? 'position', parentField: folderField, parents, model: reorderModel }),
      }).catch(() => {})

      if (onRecordsChange) onRecordsChange(flat)
    }
  }, [reorderable, reorderEndpoint, reorderField, reorderModel, folderField, onRecordsChange])

  const ItemComponent = useCallback(
    forwardRef<HTMLDivElement, TreeItemComponentProps<TreeRecord>>(
      function TreeItemWrap(props, ref) {
        return <TreeItem {...props} ref={ref} titleField={titleField} iconField={iconField} fields={fields} />
      }
    ),
    [titleField, iconField, fields]
  )

  if (records.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">No items</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-2 [&_ul]:list-none [&_ul]:m-0 [&_ul]:p-0 [&_li]:m-0">
      <SortableTree
        items={items}
        onItemsChanged={handleItemsChanged}
        TreeItemComponent={ItemComponent}
        indentationWidth={24}
        disableSorting={!reorderable}
        dropAnimation={null}
        sortableProps={{ animateLayoutChanges: () => false }}
      />
    </div>
  )
}
