import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike, RecordRow } from '../types.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { List, ListConfig } from '../schema/List.js'
import type { ViewModeMeta } from '../schema/ViewMode.js'
import type { ResourceLike } from './types.js'
import { resolveListQuery } from './resolveListQuery.js'
import { readPersistedState } from '../persist.js'
import { resolveColumns, resolveSearchColumns, applyColumnTransforms } from './helpers.js'
import { TableRegistry } from '../registries/TableRegistry.js'

// ─── List element meta (SSR payload) ────────────────────────

export interface DataViewElementMeta {
  type:              'dataview'
  title:             string
  id:                string
  records:           RecordRow[]
  // Display fields for built-in list/grid views
  titleField?:       string
  descriptionField?: string
  imageField?:       string
  // View configuration
  views?:            ViewModeMeta[]
  activeView?:       string
  // Shared data-view features
  description?:      string
  emptyMessage?:     string
  href?:             string
  searchable?:       boolean
  searchColumns?:    string[]
  pagination?:       {
    total:       number
    currentPage: number
    perPage:     number
    lastPage:    number
    type:        'pages' | 'loadMore'
  }
  filters?:          unknown[]
  actions?:          unknown[]
  activeSearch?:     string
  activeSort?:       { col: string; dir: string }
  activeFilters?:    Record<string, string>
  // Features
  lazy?:             boolean
  pollInterval?:     number
  live?:             boolean
  liveChannel?:      string
  remember?:         string
  softDeletes?:      boolean
  editable?:         boolean
  reorderable?:      boolean
  reorderEndpoint?:  string
  emptyState?:       { icon?: string; heading?: string; description?: string }
  creatableUrl?:     string | boolean
  groupBy?:          string
  recordClick?:      string  // 'view' | 'edit' — function handlers resolved per record as _href
  exportable?:       ('csv' | 'json')[]
  defaultView?:      Record<string, string>
  folderField?:      string
  // Custom render results (per record, SSR-resolved)
  renderedRecords?:  unknown[][]
}

// ─── Registry for lazy/poll List instances ───────────────────

const ListRegistry = new Map<string, Map<string, List>>()

export function registerList(panelName: string, listId: string, list: List): void {
  if (!ListRegistry.has(panelName)) ListRegistry.set(panelName, new Map())
  ListRegistry.get(panelName)!.set(listId, list)
}

export function getRegisteredList(panelName: string, listId: string): List | undefined {
  return ListRegistry.get(panelName)?.get(listId)
}

// ─── Resolver ───────────────────────────────────────────────

export async function resolveListElement(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta | null> {
  const list = el as unknown as List
  const config = list.getConfig()
  const listId = list.getId()

  // Register in both ListRegistry (for future List-specific endpoints) and
  // TableRegistry (so existing /_tables/:id fetch/remember endpoints work)
  registerList(panel.getName(), listId, list)
  TableRegistry.register(panel.getName(), listId, list as unknown as import('../schema/Table.js').Table)

  // ── Read persisted view mode (SSR) ──
  const persisted = readPersistedState(
    config.remember ?? false,
    `table:${listId}`,
    ctx,
    listId,
  )
  const persistedView = persisted?.view ? String(persisted.view) : undefined

  // ── Resolve search columns ──
  const searchColumns = config.searchColumns ?? []

  // ── Shared query pipeline ──
  const model = config.resourceClass
    ? (config.resourceClass as ResourceLike).model
    : config.model
  const result = await resolveListQuery(config, ctx, { elementId: listId, searchColumns, model })

  // ── Strip records to only needed fields (like buildTableMeta does for tables) ──
  const displayedKeys = new Set<string>(['id'])
  if (config.titleField)       displayedKeys.add(config.titleField)
  if (config.descriptionField) displayedKeys.add(config.descriptionField)
  if (config.imageField)       displayedKeys.add(config.imageField)
  if (config.groupBy)          displayedKeys.add(config.groupBy)
  // Add fields from all views (DataField/Column)
  if (config.views.length > 0) {
    for (const v of config.views) {
      const fields = v.getFields()
      if (fields) for (const f of fields) displayedKeys.add(f.getName())
    }
  }
  let records = result.records.map(record => {
    const slim: RecordRow = {}
    for (const key of displayedKeys) {
      if (key in record) slim[key] = record[key]
    }
    return slim
  })

  // ── Apply custom render function per record (SSR) ──
  let renderedRecords: unknown[][] | undefined
  if (config.renderFn) {
    renderedRecords = records.map(record => {
      const elements = config.renderFn!(record as Record<string, unknown>)
      return elements.map(el => (el as unknown as { toMeta(): unknown }).toMeta())
    })
  }

  // ── Resolve views meta ──
  // ViewMode.toMeta() serializes per-view fields (DataField/Column) into the meta.
  // Each view carries its own field definitions — the renderer reads the active view's fields.
  let viewsMeta: ViewModeMeta[] | undefined

  if (config.views.length > 0) {
    viewsMeta = config.views.map(v => v.toMeta())
  }

  // ── Resolve recordClick for function handlers ──
  let recordClick: string | undefined
  if (config.onRecordClick) {
    if (typeof config.onRecordClick === 'string') {
      recordClick = config.onRecordClick
    } else {
      // Function handler — pre-compute URL per record, store as _href
      const fn = config.onRecordClick
      records = records.map(r => ({ ...r, _href: fn(r as Record<string, unknown>) }))
      recordClick = 'custom'
    }
  }

  // ── Build meta ──
  const meta: DataViewElementMeta = {
    type:    'dataview',
    title:   config.title,
    id:      listId,
    records,
  }

  // Display fields
  if (config.titleField)       meta.titleField       = config.titleField
  if (config.descriptionField) meta.descriptionField = config.descriptionField
  if (config.imageField)       meta.imageField       = config.imageField

  // Views
  if (viewsMeta && viewsMeta.length > 0) meta.views = viewsMeta
  if (persistedView)             meta.activeView = persistedView

  // Description / empty
  if (config.description)      meta.description  = config.description
  if (config.emptyMessage)     meta.emptyMessage = config.emptyMessage
  if (config.href)             meta.href         = config.href
  if (config.emptyState)       meta.emptyState   = config.emptyState
  if (config.creatableUrl)     meta.creatableUrl = config.creatableUrl

  // Search / filter / sort
  if (config.searchable)       meta.searchable    = true
  if (config.searchColumns)    meta.searchColumns = config.searchColumns
  if (config.filters.length)   meta.filters        = config.filters.map(f => f.toMeta())
  if (config.actions.length)   meta.actions        = config.actions.map(a => a.toMeta())
  if (result.activeSearch)     meta.activeSearch   = result.activeSearch
  if (result.activeSort)       meta.activeSort     = result.activeSort
  if (result.activeFilters)    meta.activeFilters  = result.activeFilters
  if (result.pagination)       meta.pagination     = result.pagination

  // Real-time
  if (config.lazy)             meta.lazy         = true
  if (config.pollInterval)     meta.pollInterval = config.pollInterval
  if (config.live)             { meta.live = true; meta.liveChannel = `live:list:${listId}` }
  if (config.remember)         meta.remember     = config.remember as string

  // Features
  if (config.softDeletes)      meta.softDeletes      = true
  if (config.groupBy)          meta.groupBy          = config.groupBy
  if (recordClick)             meta.recordClick      = recordClick
  if (config.folderField)      meta.folderField      = config.folderField
  if (config.defaultView)      meta.defaultView      = config.defaultView

  // Export
  if (config.exportable) {
    meta.exportable = config.exportable === true ? ['csv'] : config.exportable as ('csv' | 'json')[]
  }

  // Custom render results
  if (renderedRecords)         meta.renderedRecords = renderedRecords

  return meta as unknown as PanelSchemaElementMeta
}
