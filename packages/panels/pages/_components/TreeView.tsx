'use client'

import { useState, useCallback, useEffect, forwardRef } from 'react'
import { SortableTree, SimpleTreeItemWrapper } from 'dnd-kit-sortable-tree'
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

  // First pass: create all nodes
  for (const r of records) {
    const id = String(r.id)
    map.set(id, { id, ...r, children: [] } as TreeItems<TreeRecord>[number])
  }

  // Second pass: build parent-child relationships
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

// Flatten tree back to ordered flat array with parentId
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

// ─── Tree Item Component ────────────────────────────────────

const TreeItem = forwardRef<HTMLDivElement, TreeItemComponentProps<TreeRecord> & { titleField: string; iconField?: string; fields?: DataFieldMeta[] }>(
  function TreeItemInner(props, ref) {
    const { item, titleField, iconField, fields } = props
    const icon = iconField ? item[iconField] as string | undefined : undefined
    const title = String(item[titleField] ?? item.id)

    return (
      <SimpleTreeItemWrapper {...props} ref={ref} showDragHandle>
        <div className="flex items-center gap-2 py-0.5 min-w-0">
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
      </SimpleTreeItemWrapper>
    )
  }
)

// ─── TreeView Component ─────────────────────────────────────

export function TreeView({ records, folderField, titleField, iconField, fields, reorderable, reorderEndpoint, reorderField, reorderModel, onRecordsChange }: TreeViewProps) {
  const [items, setItems] = useState<TreeItems<TreeRecord>>(() =>
    buildTree(records, folderField)
  )

  // Sync with external record changes (live updates, search, etc.)
  const recordIds = records.map(r => String(r.id)).join(',')
  useEffect(() => {
    setItems(buildTree(records, folderField))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordIds, folderField])

  const handleItemsChanged = useCallback((newItems: TreeItems<TreeRecord>, reason: ItemChangedReason<TreeRecord>) => {
    setItems(newItems)

    if (reason.type === 'dropped' && reorderable && reorderEndpoint) {
      // Flatten and send reorder request with parent mapping
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

  // Wrap TreeItem to inject our extra props
  const ItemComponent = useCallback(
    forwardRef<HTMLDivElement, TreeItemComponentProps<TreeRecord>>(
      function TreeItemWrapper(props, ref) {
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
    <div className="rounded-xl border bg-card p-2 [&_li]:list-none">
      <SortableTree
        items={items}
        onItemsChanged={handleItemsChanged}
        TreeItemComponent={ItemComponent}
        indentationWidth={24}
        disableSorting={!reorderable}
      />
    </div>
  )
}
