# Block Editor + Content Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the existing Builder field AND add a new Content field — both using a **shared flat node map** data model (inspired by Craft.js). This enables drag-to-reorder, Yjs-safe concurrent editing, and a shared block infrastructure across both field types.

**Architecture:** Both Builder and Content fields store blocks as a **flat node map** (`Record<string, Node>`) instead of an array. A `ROOT` node holds child IDs for ordering. Each block has a unique stable ID — edits target the node by ID, reordering only touches the parent's `nodes` array. This completely separates content edits from ordering, making Yjs collaboration conflict-free. The Content field adds `contenteditable` for inline rich text on top of this shared foundation. No Tiptap/ProseMirror.

**Tech Stack:** React, Yjs (Y.Map per node, Y.Array for child ordering), contenteditable, dnd-kit (drag reorder), existing @boostkit/panels field system, shadcn/base-ui components.

**Scope:**
1. **Shared node map infrastructure** — types, helpers, React hooks, dnd-kit sortable wrapper
2. **Builder field upgrade** — migrate from array to node map (with backward compat migration)
3. **Content field** — new field type using contenteditable + node map

---

## Data Model

### Storage Format (JSON, persisted to DB)

The value is a **flat map of nodes** keyed by unique ID. A `ROOT` node holds the top-level ordering.

```ts
// ContentField stores a flat node map
interface ContentNode {
  type:     string                    // 'paragraph' | 'heading' | 'image' | etc.
  props:    Record<string, unknown>   // type-specific data
  parent:   string                    // parent node ID ('ROOT' for top-level)
  nodes:    string[]                  // child node IDs (for containers)
}

type ContentValue = Record<string, ContentNode>

// Example:
{
  "ROOT": {
    "type":   "container",
    "props":  {},
    "parent": "",
    "nodes":  ["n1", "n2", "n3", "n4"]
  },
  "n1": {
    "type":   "paragraph",
    "props":  { "text": "Hello <b>world</b>!" },
    "parent": "ROOT",
    "nodes":  []
  },
  "n2": {
    "type":   "heading",
    "props":  { "text": "My Title", "level": 2 },
    "parent": "ROOT",
    "nodes":  []
  },
  "n3": {
    "type":   "image",
    "props":  { "src": "/storage/content/photo.jpg", "alt": "A photo" },
    "parent": "ROOT",
    "nodes":  []
  },
  "n4": {
    "type":   "divider",
    "props":  {},
    "parent": "ROOT",
    "nodes":  []
  }
}
```

### Why flat map over array?

| Operation | Array model | Flat map model |
|-----------|------------|----------------|
| Edit block text | Mutate `blocks[2].text` — index-dependent | Mutate `nodes["n1"].props.text` — ID-stable |
| Reorder blocks | Splice array — shifts all indexes | Move ID in parent's `nodes` array — content untouched |
| Concurrent edit + drag | **CONFLICT** — edit targets wrong block | **NO CONFLICT** — independent Y.Map paths |
| Nested blocks | Awkward (recursive arrays) | Natural (node.nodes = child IDs) |

### Yjs Structure (collaborative mode)

```
Y.Doc
  └── Y.Map('content')                    // the ContentField value
        ├── "ROOT" → Y.Map
        │     ├── type: "container"
        │     ├── props: Y.Map {}
        │     └── nodes: Y.Array ["n1", "n2", "n3"]    ← ordering (conflict-free reorder)
        ├── "n1" → Y.Map
        │     ├── type: "paragraph"
        │     ├── props: Y.Map { text: Y.Text("Hello world!") }  ← character-level CRDT
        │     ├── parent: "ROOT"
        │     └── nodes: Y.Array []
        ├── "n2" → Y.Map
        │     ├── type: "heading"
        │     ├── props: Y.Map { text: Y.Text("My Title"), level: 2 }
        │     └── ...
        └── ...
```

**Key properties:**
- Each node is its own Y.Map — editing one node never touches another
- `nodes` is a Y.Array of string IDs — reordering is a Y.Array move operation
- Text props use Y.Text — character-level merging + inline formatting attributes (`{ bold: true }`)
- Non-text props (src, level, language) are plain Y.Map values
- Adding/removing blocks = inserting/deleting from parent's `nodes` Y.Array + adding/removing node Y.Map

---

## Task Overview

### Phase A: Shared Node Map Infrastructure

| # | Task | Scope |
|---|------|-------|
| A1 | Node map types + helpers | `packages/panels/src/NodeMap.ts` |
| A2 | SortableBlockList React component (dnd-kit) | `packages/panels/pages/_components/SortableBlockList.tsx` |
| A3 | Export node map from panels | `packages/panels/src/index.ts` |

### Phase B: Repeater + Builder Field Upgrade (array → node map)

| # | Task | Scope |
|---|------|-------|
| B1 | Migrate Repeater FieldInput to node map + dnd-kit | `packages/panels/pages/_components/FieldInput.tsx` |
| B2 | Migrate Builder FieldInput to node map + dnd-kit | `packages/panels/pages/_components/FieldInput.tsx` |
| B3 | Ensure coercePayload handles NodeMap | `packages/panels/src/PanelServiceProvider.ts` |
| B4 | Sync + smoke test Repeater + Builder | Verify existing data still works |

### Phase C: Content Field (new)

| # | Task | Scope |
|---|------|-------|
| C1 | ContentField backend class | `packages/panels/src/fields/ContentField.ts` |
| C2 | Content block type registry | `packages/panels/src/ContentBlock.ts` |
| C3 | ContentEditor React component | `packages/panels/pages/_components/ContentEditor.tsx` |
| C4 | RichTextBlock — contenteditable with formatting | `packages/panels/pages/_components/content-blocks/RichTextBlock.tsx` |
| C5 | Inline formatting toolbar | `packages/panels/pages/_components/content-blocks/InlineToolbar.tsx` |
| C6 | Image, Divider, Code, Quote, List blocks | `packages/panels/pages/_components/content-blocks/` |
| C7 | Block picker (button + grouped menu) | `packages/panels/pages/_components/content-blocks/BlockPicker.tsx` |
| C8 | Wire ContentField into FieldInput | `packages/panels/pages/_components/FieldInput.tsx` |
| C9 | Read-only ContentRenderer | `packages/panels/pages/_components/ContentRenderer.tsx` |

### Phase D: Integration

| # | Task | Scope |
|---|------|-------|
| D1 | Yjs collaborative binding for node map fields | `packages/panels/pages/_hooks/useCollaborativeForm.ts` |
| D2 | Playground demo (ContentField on Article) | `playground/app/Panels/Admin/resources/ArticleResource.ts` |
| D3 | Sync to playground + smoke test | Copy pages, run dev, verify all |

---

## Phase A: Shared Node Map Infrastructure

### Task A1: Node Map Types + Helpers

**Files:**
- Create: `packages/panels/src/NodeMap.ts`

This is the shared foundation used by **both** Builder and Content fields. It defines the flat node map data model and pure-function helpers for manipulating it.

**Step 1: Create the module**

```ts
// packages/panels/src/NodeMap.ts

// ─── Types ───────────────────────────────────────────────────

/** A single node in a flat node tree. */
export interface NodeData {
  type:   string                    // block type name (e.g. 'hero', 'paragraph', 'image')
  props:  Record<string, unknown>   // type-specific data
  parent: string                    // parent node ID ('' for ROOT)
  nodes:  string[]                  // ordered child IDs (empty for leaf nodes)
}

/** Flat map of nodeId → NodeData. Always has a ROOT entry. */
export type NodeMap = Record<string, NodeData>

// ─── ID generation ───────────────────────────────────────────

/** Generate a short unique node ID. */
export function nodeId(): string {
  return Math.random().toString(36).slice(2, 8)
}

// ─── Factory ─────────────────────────────────────────────────

/** Create an empty NodeMap with just a ROOT container. */
export function emptyNodeMap(): NodeMap {
  return {
    ROOT: { type: 'container', props: {}, parent: '', nodes: [] },
  }
}

// ─── Pure helpers (return new NodeMap — never mutate) ─────────

/** Add a node at a given position in the parent's children. */
export function addNode(
  map: NodeMap,
  type: string,
  props: Record<string, unknown>,
  parentId: string = 'ROOT',
  atIndex?: number,
): { map: NodeMap; id: string } {
  const id     = nodeId()
  const parent = map[parentId]
  if (!parent) return { map, id }

  const newNodes = [...parent.nodes]
  const idx = atIndex ?? newNodes.length
  newNodes.splice(idx, 0, id)

  return {
    id,
    map: {
      ...map,
      [parentId]: { ...parent, nodes: newNodes },
      [id]:       { type, props, parent: parentId, nodes: [] },
    },
  }
}

/** Update a node's props (shallow merge). */
export function updateNodeProps(
  map: NodeMap,
  id: string,
  propsPatch: Record<string, unknown>,
): NodeMap {
  const node = map[id]
  if (!node) return map
  return { ...map, [id]: { ...node, props: { ...node.props, ...propsPatch } } }
}

/** Remove a node and its ID from its parent's nodes array. */
export function removeNode(map: NodeMap, id: string): NodeMap {
  const node = map[id]
  if (!node) return map
  const parent = map[node.parent]
  if (!parent) return map

  const { [id]: _removed, ...rest } = map
  return {
    ...rest,
    [node.parent]: { ...parent, nodes: parent.nodes.filter(nid => nid !== id) },
  }
}

/** Move a node up or down within its parent's nodes array. */
export function moveNode(map: NodeMap, id: string, direction: -1 | 1): NodeMap {
  const node = map[id]
  if (!node) return map
  const parent = map[node.parent]
  if (!parent) return map

  const nodes = [...parent.nodes]
  const idx   = nodes.indexOf(id)
  const other = idx + direction
  if (other < 0 || other >= nodes.length) return map
  ;[nodes[idx], nodes[other]] = [nodes[other]!, nodes[idx]!]

  return { ...map, [node.parent]: { ...parent, nodes } }
}

/** Reorder: move a node from one index to another (for dnd-kit). */
export function reorderNode(map: NodeMap, id: string, fromIndex: number, toIndex: number): NodeMap {
  const node = map[id]
  if (!node) return map
  const parent = map[node.parent]
  if (!parent) return map

  const nodes = [...parent.nodes]
  nodes.splice(fromIndex, 1)
  nodes.splice(toIndex, 0, id)

  return { ...map, [node.parent]: { ...parent, nodes } }
}

// ─── Migration: array → NodeMap ──────────────────────────────

/**
 * Convert a legacy array-of-blocks `[{ _type, ...fields }]` into a NodeMap.
 * Used for backward compatibility with existing Builder field data.
 */
export function arrayToNodeMap(
  blocks: Array<{ _type: string; [key: string]: unknown }>,
): NodeMap {
  const map: NodeMap = {
    ROOT: { type: 'container', props: {}, parent: '', nodes: [] },
  }
  for (const block of blocks) {
    const id = nodeId()
    const { _type, ...props } = block
    map.ROOT!.nodes.push(id)
    map[id] = { type: _type, props, parent: 'ROOT', nodes: [] }
  }
  return map
}

/**
 * Convert a NodeMap back to array format for reading.
 * Walks ROOT.nodes in order and flattens to [{ _type, ...props }].
 */
export function nodeMapToArray(
  map: NodeMap,
): Array<{ _type: string; [key: string]: unknown }> {
  const root = map.ROOT
  if (!root) return []
  return root.nodes
    .map(id => map[id])
    .filter(Boolean)
    .map(node => ({ _type: node!.type, ...node!.props }))
}

/**
 * Detect if a value is already a NodeMap or a legacy array.
 * Returns a normalized NodeMap either way.
 */
export function ensureNodeMap(value: unknown): NodeMap {
  if (!value) return emptyNodeMap()
  if (Array.isArray(value)) return arrayToNodeMap(value)
  if (typeof value === 'object' && 'ROOT' in (value as object)) return value as NodeMap
  return emptyNodeMap()
}
```

**Step 2: Commit**

```bash
git add packages/panels/src/NodeMap.ts
git commit -m "feat(panels): add shared NodeMap types and pure helpers"
```

---

### Task A2: SortableBlockList React Component (dnd-kit)

**Files:**
- Create: `packages/panels/pages/_components/SortableBlockList.tsx`

A shared drag-to-reorder wrapper used by both Builder and Content editors.

**Step 1: Check dnd-kit is installed**

```bash
cd playground && grep '@dnd-kit' package.json
```

If not installed:
```bash
cd playground && pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Step 2: Create the component**

```tsx
// packages/panels/pages/_components/SortableBlockList.tsx
import { DndContext, closestCenter, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { icons } from 'lucide-react'

const GripVertical = icons['GripVertical']!

interface Props {
  /** Ordered node IDs. */
  nodeIds:    string[]
  /** Called when a drag completes with (activeId, oldIndex, newIndex). */
  onReorder:  (id: string, fromIndex: number, toIndex: number) => void
  /** Render function for each node. Receives the node ID. */
  renderNode: (id: string, index: number) => React.ReactNode
  disabled?:  boolean
}

export function SortableBlockList({ nodeIds, onReorder, renderNode, disabled }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = nodeIds.indexOf(active.id as string)
    const newIndex = nodeIds.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(active.id as string, oldIndex, newIndex)
  }

  if (disabled) {
    return (
      <>
        {nodeIds.map((id, index) => (
          <div key={id}>{renderNode(id, index)}</div>
        ))}
      </>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={nodeIds} strategy={verticalListSortingStrategy}>
        {nodeIds.map((id, index) => (
          <SortableItem key={id} id={id}>
            {renderNode(id, index)}
          </SortableItem>
        ))}
      </SortableContext>
    </DndContext>
  )
}

function SortableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-50 z-50' : ''}
      {...attributes}
    >
      <div className="group relative">
        {/* Drag handle */}
        <div
          {...listeners}
          className="absolute -left-8 top-2 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <GripVertical className="size-4 text-muted-foreground" />
        </div>
        {children}
      </div>
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add packages/panels/pages/_components/SortableBlockList.tsx
git commit -m "feat(panels): add shared SortableBlockList with dnd-kit"
```

---

### Task A3: Export NodeMap from Panels

**Files:**
- Modify: `packages/panels/src/index.ts`

**Step 1: Add exports**

After the `Block` export line (~line 53), add:

```ts
// ─── Node Map (shared block infrastructure) ──────────────────
export {
  nodeId, emptyNodeMap,
  addNode, updateNodeProps, removeNode, moveNode, reorderNode,
  arrayToNodeMap, nodeMapToArray, ensureNodeMap,
} from './NodeMap.js'
export type { NodeData, NodeMap } from './NodeMap.js'
```

**Step 2: Build and verify**

```bash
cd packages/panels && pnpm build
```

**Step 3: Commit**

```bash
git add packages/panels/src/index.ts
git commit -m "feat(panels): export shared NodeMap infrastructure"
```

---

## Phase B: Repeater + Builder Field Upgrade (array → node map)

### Task B1: Migrate Repeater FieldInput to Node Map + dnd-kit

**Files:**
- Modify: `packages/panels/pages/_components/FieldInput.tsx` (repeater section, ~lines 299-370)

The Repeater is the simpler case — one implicit block type (`item`), same schema for every row. Upgrade it to use NodeMap + SortableBlockList for stable IDs and drag reorder.

**Step 1: Replace the repeater section in FieldInput.tsx**

```tsx
// Replace the existing repeater section with:

// ── Repeater ──────────────────────────────────────────────
if (field.type === 'repeater') {
  const schema   = (field.extra?.schema ?? []) as FieldMeta[]
  const addLabel = (field.extra?.addLabel as string) ?? i18n.addItem
  const maxItems = field.extra?.maxItems as number | undefined

  // Normalize: accept legacy array OR node map
  const nodeMap  = ensureNodeMap(value)
  const root     = nodeMap.ROOT!
  const nodeIds  = root.nodes

  function emit(next: NodeMap) { onChange(next) }

  function handleAddItem() {
    if (maxItems !== undefined && nodeIds.length >= maxItems) return
    const props: Record<string, unknown> = {}
    for (const f of schema) props[f.name] = undefined
    const { map } = addNode(nodeMap, 'item', props)
    emit(map)
  }

  function handleUpdateItem(id: string, fieldName: string, fieldValue: unknown) {
    emit(updateNodeProps(nodeMap, id, { [fieldName]: fieldValue }))
  }

  function handleRemoveItem(id: string) {
    emit(removeNode(nodeMap, id))
  }

  function handleReorder(id: string, fromIndex: number, toIndex: number) {
    emit(reorderNode(nodeMap, id, fromIndex, toIndex))
  }

  return (
    <div className="flex flex-col gap-3">
      <SortableBlockList
        nodeIds={nodeIds}
        onReorder={handleReorder}
        disabled={isDisabled}
        renderNode={(id, index) => {
          const node = nodeMap[id]
          if (!node) return null
          return (
            <div className="rounded-lg border border-input bg-card p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t(i18n.item, { n: index + 1 })}
                </span>
                {!isDisabled && (
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(id)}
                    className="text-xs text-destructive hover:underline"
                  >
                    {i18n.remove}
                  </button>
                )}
              </div>
              {schema.map((subField) => (
                <div key={subField.name} className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">
                    {subField.label}
                    {subField.required && <span className="text-destructive ml-0.5">*</span>}
                  </label>
                  <FieldInput
                    field={subField}
                    value={node.props[subField.name]}
                    onChange={(v) => handleUpdateItem(id, subField.name, v)}
                    uploadBase={uploadBase}
                    i18n={i18n}
                  />
                </div>
              ))}
            </div>
          )
        }}
      />

      {/* Add item button */}
      {!isDisabled && (maxItems === undefined || nodeIds.length < maxItems) && (
        <button
          type="button"
          onClick={handleAddItem}
          className="flex items-center gap-2 px-4 py-2 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full justify-center"
        >
          <span className="text-base leading-none">+</span>
          {addLabel}
        </button>
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add packages/panels/pages/_components/FieldInput.tsx
git commit -m "feat(panels): upgrade Repeater field to NodeMap + dnd-kit drag reorder"
```

---

### Task B2: Migrate Builder FieldInput to Node Map + dnd-kit

**Files:**
- Modify: `packages/panels/pages/_components/FieldInput.tsx` (builder section, ~lines 372-507)

The existing Builder field renders an array of `{ _type, ...fields }` blocks. We upgrade it to:
1. Accept either array (legacy) or NodeMap format via `ensureNodeMap()`
2. Store as NodeMap internally
3. Use `SortableBlockList` for drag reorder
4. Use stable node IDs as React keys (not array indexes)

**Step 1: Replace the builder section in FieldInput.tsx**

```tsx
// Replace the existing builder section (lines 372-507) with:

// ── Builder ──────────────────────────────────────────────
if (field.type === 'builder') {
  const blockDefs = (field.extra?.blocks ?? []) as Array<{
    name: string; label: string; icon?: string; schema: FieldMeta[]
  }>
  const addLabel = (field.extra?.addLabel as string) ?? i18n.addBlock
  const maxItems = field.extra?.maxItems as number | undefined

  // Normalize: accept legacy array OR node map
  const nodeMap  = ensureNodeMap(value)
  const root     = nodeMap.ROOT!
  const nodeIds  = root.nodes
  const [pickerOpen, setPickerOpen] = useState(false)

  // Emit as NodeMap (new format)
  function emit(next: NodeMap) { onChange(next) }

  function handleAddBlock(blockName: string) {
    const def = blockDefs.find((b) => b.name === blockName)
    if (!def) return
    const props: Record<string, unknown> = {}
    for (const f of def.schema) props[f.name] = undefined
    const { map } = addNode(nodeMap, blockName, props)
    emit(map)
    setPickerOpen(false)
  }

  function handleUpdateBlock(id: string, fieldName: string, fieldValue: unknown) {
    const node = nodeMap[id]
    if (!node) return
    emit(updateNodeProps(nodeMap, id, { [fieldName]: fieldValue }))
  }

  function handleRemoveBlock(id: string) {
    emit(removeNode(nodeMap, id))
  }

  function handleReorder(id: string, fromIndex: number, toIndex: number) {
    emit(reorderNode(nodeMap, id, fromIndex, toIndex))
  }

  const atMax = maxItems !== undefined && nodeIds.length >= maxItems

  return (
    <div className="flex flex-col gap-3">
      <SortableBlockList
        nodeIds={nodeIds}
        onReorder={handleReorder}
        disabled={isDisabled}
        renderNode={(id) => {
          const node = nodeMap[id]
          if (!node) return null
          const def = blockDefs.find((b) => b.name === node.type)
          return (
            <div className="rounded-lg border border-input bg-card overflow-hidden">
              {/* Block header */}
              <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-input">
                <span className="flex items-center gap-2 text-xs font-medium">
                  {def?.icon && <span>{def.icon}</span>}
                  <span className="text-muted-foreground uppercase tracking-wide">
                    {def?.label ?? node.type}
                  </span>
                </span>
                {!isDisabled && (
                  <button
                    type="button"
                    onClick={() => handleRemoveBlock(id)}
                    className="px-1.5 py-0.5 text-xs text-destructive hover:underline"
                  >{i18n.remove}</button>
                )}
              </div>

              {/* Block fields */}
              <div className="p-4 flex flex-col gap-4">
                {(def?.schema ?? []).map((subField) => (
                  <div key={subField.name} className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">
                      {subField.label}
                      {subField.required && <span className="text-destructive ml-0.5">*</span>}
                    </label>
                    <FieldInput
                      field={subField}
                      value={node.props[subField.name]}
                      onChange={(v) => handleUpdateBlock(id, subField.name, v)}
                      uploadBase={uploadBase}
                      i18n={i18n}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        }}
      />

      {/* Block picker */}
      {!atMax && !isDisabled && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full justify-center"
          >
            <span className="text-base leading-none">+</span>
            {addLabel}
          </button>

          {pickerOpen && (
            <div className="absolute bottom-full mb-2 left-0 z-20 w-full rounded-lg border border-border bg-popover shadow-lg py-1 overflow-hidden">
              {blockDefs.map((def) => (
                <button
                  key={def.name}
                  type="button"
                  onClick={() => handleAddBlock(def.name)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                >
                  {def.icon && <span className="text-base shrink-0">{def.icon}</span>}
                  <div>
                    <p className="font-medium">{def.label}</p>
                    <p className="text-xs text-muted-foreground">{def.schema.length} field{def.schema.length !== 1 ? 's' : ''}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

Also add imports at the top of FieldInput.tsx:
```tsx
import { ensureNodeMap, addNode, updateNodeProps, removeNode, reorderNode } from '@boostkit/panels'
import type { NodeMap } from '@boostkit/panels'
import { SortableBlockList } from './SortableBlockList.js'
```

**Step 2: Commit**

```bash
git add packages/panels/pages/_components/FieldInput.tsx
git commit -m "feat(panels): upgrade Builder field to NodeMap + dnd-kit drag reorder"
```

---

### Task B3: Backward Compatibility — coercePayload + data loading

**Files:**
- Modify: `packages/panels/src/PanelServiceProvider.ts` (coercePayload section)

When saving a Builder field, the backend receives a NodeMap. When reading, old data may be an array. The `ensureNodeMap()` helper handles the read side (frontend). For the write side, the NodeMap is stored directly as JSON — no conversion needed (Prisma stores it as-is in a `Json` column).

**Step 1: Verify existing coercePayload handles objects**

Check that `coercePayload` doesn't try to iterate Builder values as arrays. If it does, add a guard:

```ts
// In coercePayload, the builder case should be:
case 'builder':
  // Store as-is (NodeMap object or legacy array — both valid JSON)
  break
```

**Step 2: Commit (if changes needed)**

```bash
git add packages/panels/src/PanelServiceProvider.ts
git commit -m "fix(panels): ensure coercePayload handles NodeMap for builder fields"
```

---

### Task B4: Sync + Smoke Test Repeater + Builder

**Step 1: Copy pages to playground**

```bash
cp -r packages/panels/pages/_components/ playground/pages/\(panels\)/_components/
cp -r packages/panels/pages/_hooks/ playground/pages/\(panels\)/_hooks/
cp -r packages/panels/pages/@panel/ playground/pages/\(panels\)/@panel/
```

**Step 2: Build and run**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm dev
```

**Step 3: Smoke test checklist**

Repeater:
- [ ] Navigate to a resource with Repeater field
- [ ] Existing array-format data loads correctly (migration via `ensureNodeMap`)
- [ ] Add a new item — appears at bottom
- [ ] Drag an item to reorder — dnd-kit handle works
- [ ] Edit item fields — values update
- [ ] Remove an item — disappears
- [ ] Save — NodeMap stored as JSON in DB
- [ ] Reload — NodeMap loads correctly

Builder:
- [ ] Navigate to article create/edit with Builder field
- [ ] Existing array-format data loads correctly (migration via `ensureNodeMap`)
- [ ] Add a new block — appears at bottom
- [ ] Drag a block to reorder — dnd-kit handle works
- [ ] Edit block fields — values saved correctly
- [ ] Remove a block — disappears
- [ ] Save — NodeMap stored as JSON in DB
- [ ] Reload — NodeMap loads correctly

**Step 4: Commit**

```bash
git add playground/pages/
git commit -m "feat(playground): sync Repeater + Builder upgrade with dnd-kit reorder"
```

---

## Phase C: Content Field (new)

### Task C1: ContentField Backend Class

**Files:**
- Create: `packages/panels/src/fields/ContentField.ts`
- Modify: `packages/panels/src/index.ts`

**Step 1: Create the field class**

```ts
// packages/panels/src/fields/ContentField.ts
import { Field } from '../Field.js'

export class ContentField extends Field {
  constructor(name: string) {
    super(name)
    this._extra['blockTypes'] = [
      'paragraph', 'heading', 'image', 'divider', 'code', 'quote', 'list',
    ]
  }

  static make(name: string): ContentField {
    return new ContentField(name)
  }

  /** Restrict which block types are available. */
  blockTypes(types: string[]): this {
    this._extra['blockTypes'] = types
    return this
  }

  /** Placeholder text for empty editor. */
  placeholder(text: string): this {
    this._extra['placeholder'] = text
    return this
  }

  /** Maximum blocks allowed. */
  maxBlocks(n: number): this {
    this._extra['maxBlocks'] = n
    return this
  }

  getType(): string { return 'content' }
}
```

**Step 2: Add exports to index.ts**

```ts
export { ContentField }     from './fields/ContentField.js'
export { contentBlockDefs } from './ContentBlock.js'
export type { ContentBlockDef } from './ContentBlock.js'
```

**Step 3: Commit**

```bash
git add packages/panels/src/fields/ContentField.ts packages/panels/src/index.ts
git commit -m "feat(panels): add ContentField backend class"
```

---

---

### Task C2: Content Block Type Registry

---

### Task C3: ContentEditor React Component

**Files:**
- Create: `packages/panels/pages/_components/ContentEditor.tsx`

This is the main orchestrator. It operates on the **flat node map** — reads ROOT.nodes for ordering, looks up each node by ID, and delegates rendering.

**Step 1: Create the component**

```tsx
// packages/panels/pages/_components/ContentEditor.tsx
import { useRef } from 'react'
import type { ContentBlockDef, NodeData, NodeMap } from '@boostkit/panels'
import { contentBlockDefs, ensureNodeMap, addNode, updateNodeProps, removeNode, reorderNode } from '@boostkit/panels'
import { RichTextBlock } from './content-blocks/RichTextBlock.js'
import { ImageBlock } from './content-blocks/ImageBlock.js'
import { CodeBlock } from './content-blocks/CodeBlock.js'
import { DividerBlock } from './content-blocks/DividerBlock.js'
import { ListBlock } from './content-blocks/ListBlock.js'
import { BlockPicker } from './content-blocks/BlockPicker.js'
import { InlineToolbar } from './content-blocks/InlineToolbar.js'
import { SortableBlockList } from './SortableBlockList.js'

/** Default props for each content block type. */
const defaultBlockProps: Record<string, Record<string, unknown>> = {
  paragraph: { text: '' },
  heading:   { text: '', level: 2 },
  image:     { src: '', alt: '', caption: '' },
  divider:   {},
  code:      { code: '', language: '' },
  quote:     { text: '' },
  list:      { style: 'bullet', items: [''] },
}

interface Props {
  value:          NodeMap
  onChange:       (value: NodeMap) => void
  allowedBlocks?: string[]
  placeholder?:   string
  maxBlocks?:     number
  uploadBase?:    string
  disabled?:      boolean
}

export function ContentEditor({ value: rawValue, onChange, allowedBlocks, placeholder, maxBlocks, uploadBase, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const value   = ensureNodeMap(rawValue)
  const root    = value.ROOT!
  const nodeIds = root.nodes
  const defs    = contentBlockDefs.filter(d => !allowedBlocks || allowedBlocks.includes(d.type))
  const atMax   = maxBlocks !== undefined && nodeIds.length >= maxBlocks

  function handleAddBlock(type: string, atIndex?: number) {
    const props = defaultBlockProps[type]
    if (!props || atMax) return
    const { map } = addNode(value, type, { ...props }, 'ROOT', atIndex)
    onChange(map)
  }

  function handleUpdateNode(id: string, propsPatch: Record<string, unknown>) {
    onChange(updateNodeProps(value, id, propsPatch))
  }

  function handleRemoveNode(id: string) {
    onChange(removeNode(value, id))
  }

  function handleReorder(id: string, fromIndex: number, toIndex: number) {
    onChange(reorderNode(value, id, fromIndex, toIndex))
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1 min-h-[200px] rounded-lg border border-input bg-background p-3 pl-12">
      <InlineToolbar containerRef={containerRef} />

      {nodeIds.length === 0 && !disabled && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <BlockPicker defs={defs} onSelect={(type) => handleAddBlock(type)} trigger="empty" placeholder={placeholder} />
        </div>
      )}

      <SortableBlockList
        nodeIds={nodeIds}
        onReorder={handleReorder}
        disabled={disabled}
        renderNode={(id, index) => {
          const node = value[id]
          if (!node) return null
          return (
            <div className="group/content-block">
              {/* Delete button — top right on hover */}
              {!disabled && (
                <div className="absolute right-1 top-0 opacity-0 group-hover/content-block:opacity-100 transition-opacity z-10">
                  <button type="button" onClick={() => handleRemoveNode(id)}
                    className="text-xs text-destructive hover:text-destructive/80 p-0.5">×</button>
                </div>
              )}

              {/* Block content */}
              {renderBlock(node, (patch) => handleUpdateNode(id, patch), uploadBase, disabled)}

              {/* Inline add between blocks */}
              {!disabled && !atMax && (
                <div className="h-0 relative">
                  <div className="absolute inset-x-0 -top-0.5 flex justify-center opacity-0 group-hover/content-block:opacity-100 transition-opacity z-10">
                    <BlockPicker defs={defs} onSelect={(type) => handleAddBlock(type, index + 1)} trigger="between" />
                  </div>
                </div>
              )}
            </div>
          )
        }}
      />

      {/* Bottom add button */}
      {nodeIds.length > 0 && !disabled && !atMax && (
        <div className="flex justify-center pt-2">
          <BlockPicker defs={defs} onSelect={(type) => handleAddBlock(type)} trigger="bottom" />
        </div>
      )}
    </div>
  )
}

function renderBlock(
  node: NodeData,
  updateProps: (patch: Record<string, unknown>) => void,
  uploadBase?: string,
  disabled?: boolean,
) {
  const p = node.props

  switch (node.type) {
    case 'paragraph':
      return <RichTextBlock text={(p.text as string) ?? ''} onChange={(text) => updateProps({ text })} tag="p" disabled={disabled} />
    case 'heading':
      return (
        <div className="flex items-center gap-2">
          <select
            value={(p.level as number) ?? 2}
            onChange={(e) => updateProps({ level: Number(e.target.value) })}
            className="text-xs border rounded px-1 py-0.5 bg-background"
            disabled={disabled}
          >
            <option value={1}>H1</option>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
          <div className="flex-1">
            <RichTextBlock text={(p.text as string) ?? ''} onChange={(text) => updateProps({ text })} tag={`h${p.level ?? 2}` as 'h1' | 'h2' | 'h3'} disabled={disabled} />
          </div>
        </div>
      )
    case 'quote':
      return (
        <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic">
          <RichTextBlock text={(p.text as string) ?? ''} onChange={(text) => updateProps({ text })} tag="p" disabled={disabled} />
        </blockquote>
      )
    case 'image':
      return <ImageBlock src={(p.src as string) ?? ''} alt={(p.alt as string) ?? ''} caption={(p.caption as string) ?? ''} onChange={updateProps} uploadBase={uploadBase} disabled={disabled} />
    case 'code':
      return <CodeBlock code={(p.code as string) ?? ''} language={(p.language as string) ?? ''} onChange={updateProps} disabled={disabled} />
    case 'divider':
      return <DividerBlock />
    case 'list':
      return <ListBlock style={(p.style as 'bullet' | 'numbered') ?? 'bullet'} items={Array.isArray(p.items) ? (p.items as string[]) : ['']} onChange={updateProps} disabled={disabled} />
    default:
      return <div className="text-xs text-muted-foreground py-2">Unknown block: {node.type}</div>
  }
}
```

**Key design notes:**
- Uses shared `NodeMap` type and helpers from `NodeMap.ts` — same as Builder field
- Uses shared `SortableBlockList` for drag-to-reorder — same as Builder field
- `ensureNodeMap()` handles undefined/null initial values
- `renderBlock` dispatches to content-specific block components (RichTextBlock, ImageBlock, etc.)

**Step 2: Commit**

```bash
git add packages/panels/pages/_components/ContentEditor.tsx
git commit -m "feat(panels): add ContentEditor using shared NodeMap + SortableBlockList"
```

---

### Task C4: RichTextBlock — ContentEditable with Formatting

**Files:**
- Create: `packages/panels/pages/_components/content-blocks/RichTextBlock.tsx`

This is the core innovation — a lightweight contenteditable div that supports bold, italic, underline, and link formatting. No Tiptap.

**Step 1: Create the component**

```tsx
// packages/panels/pages/_components/content-blocks/RichTextBlock.tsx
import { useRef, useCallback, useEffect } from 'react'

interface Props {
  text:      string          // HTML string (may contain <b>, <i>, <a>)
  onChange:  (text: string) => void
  tag?:      'p' | 'h1' | 'h2' | 'h3'
  disabled?: boolean
  placeholder?: string
}

const tagStyles: Record<string, string> = {
  p:  'text-base',
  h1: 'text-3xl font-bold',
  h2: 'text-2xl font-semibold',
  h3: 'text-xl font-semibold',
}

/**
 * Minimal rich-text block using contentEditable.
 * Supports inline formatting: bold, italic, underline, strikethrough, link.
 * Formatting is applied via document.execCommand (widely supported, simple).
 *
 * The value is stored as an HTML string with only allowed tags:
 * <b>, <i>, <u>, <s>, <a href="...">.
 */
export function RichTextBlock({ text, onChange, tag = 'p', disabled, placeholder }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const lastHtml = useRef(text)

  // Sync external text changes (e.g., collaborative updates)
  useEffect(() => {
    if (ref.current && text !== lastHtml.current) {
      // Save and restore cursor position
      const sel = window.getSelection()
      const hadFocus = document.activeElement === ref.current

      ref.current.innerHTML = text
      lastHtml.current = text

      // Restore cursor to end if we had focus
      if (hadFocus && sel && ref.current.childNodes.length > 0) {
        const range = document.createRange()
        range.selectNodeContents(ref.current)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    }
  }, [text])

  const handleInput = useCallback(() => {
    if (!ref.current) return
    const html = sanitizeHtml(ref.current.innerHTML)
    if (html !== lastHtml.current) {
      lastHtml.current = html
      onChange(html)
    }
  }, [onChange])

  // Handle keyboard shortcuts for formatting
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return
    const mod = e.metaKey || e.ctrlKey

    if (mod && e.key === 'b') {
      e.preventDefault()
      document.execCommand('bold')
    } else if (mod && e.key === 'i') {
      e.preventDefault()
      document.execCommand('italic')
    } else if (mod && e.key === 'u') {
      e.preventDefault()
      document.execCommand('underline')
    } else if (mod && e.key === 'k') {
      e.preventDefault()
      const url = prompt('Link URL:')
      if (url) document.execCommand('createLink', false, url)
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // Prevent default <div> insertion — use <br> instead
      e.preventDefault()
      document.execCommand('insertLineBreak')
    }
  }, [disabled])

  return (
    <div className="relative">
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        data-placeholder={placeholder ?? ''}
        className={[
          tagStyles[tag] ?? tagStyles.p,
          'outline-none min-h-[1.5em] px-1 py-0.5 rounded',
          'focus:bg-accent/30 transition-colors',
          'empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50',
          disabled ? 'cursor-default' : '',
          // Links inside should be styled
          '[&_a]:text-primary [&_a]:underline',
        ].join(' ')}
        dangerouslySetInnerHTML={{ __html: text }}
      />
    </div>
  )
}

/** Strip everything except allowed inline tags. */
function sanitizeHtml(html: string): string {
  // Remove all tags except: b, i, u, s, a, br
  return html
    .replace(/<(?!\/?(?:b|i|u|s|a|br)\b)[^>]*>/gi, '')
    // Remove all attributes from allowed tags except href on <a>
    .replace(/<(b|i|u|s|br)(\s[^>]*)?>/gi, '<$1>')
    .replace(/<a\s+(?:(?!href)[^>])*?(href="[^"]*")[^>]*>/gi, '<a $1>')
    // Clean up empty tags
    .replace(/<(\w+)>\s*<\/\1>/g, '')
    // Normalize whitespace
    .replace(/&nbsp;/g, ' ')
}
```

**Step 2: Commit**

```bash
mkdir -p packages/panels/pages/_components/content-blocks
git add packages/panels/pages/_components/content-blocks/RichTextBlock.tsx
git commit -m "feat(panels): add RichTextBlock with contenteditable formatting"
```

---

### Task C5: Inline Formatting Toolbar

**Files:**
- Create: `packages/panels/pages/_components/content-blocks/InlineToolbar.tsx`

A floating toolbar that appears when text is selected inside a RichTextBlock. Shows bold, italic, underline, strikethrough, link buttons.

**Step 1: Create the toolbar**

```tsx
// packages/panels/pages/_components/content-blocks/InlineToolbar.tsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { icons } from 'lucide-react'

const BoldIcon        = icons['Bold']!
const ItalicIcon      = icons['Italic']!
const UnderlineIcon   = icons['Underline']!
const StrikethroughIcon = icons['Strikethrough']!
const LinkIcon        = icons['Link']!
const UnlinkIcon      = icons['Unlink']!

interface ToolbarState {
  visible: boolean
  x: number
  y: number
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  link: boolean
}

/**
 * Floating inline toolbar — attaches to `document` selection events.
 * Renders above selected text inside the contenteditable container.
 * Must be rendered inside the ContentEditor so it has correct positioning context.
 */
export function InlineToolbar({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const [state, setState] = useState<ToolbarState>({
    visible: false, x: 0, y: 0,
    bold: false, italic: false, underline: false, strikethrough: false, link: false,
  })
  const toolbarRef = useRef<HTMLDivElement>(null)

  const checkSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setState(s => ({ ...s, visible: false }))
      return
    }

    // Only show if selection is inside our container
    const range = sel.getRangeAt(0)
    if (!containerRef.current?.contains(range.commonAncestorContainer)) {
      setState(s => ({ ...s, visible: false }))
      return
    }

    const rect = range.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()

    setState({
      visible: true,
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top - containerRect.top - 8,
      bold:          document.queryCommandState('bold'),
      italic:        document.queryCommandState('italic'),
      underline:     document.queryCommandState('underline'),
      strikethrough: document.queryCommandState('strikeThrough'),
      link:          !!findParentAnchor(sel.anchorNode),
    })
  }, [containerRef])

  useEffect(() => {
    document.addEventListener('selectionchange', checkSelection)
    return () => document.removeEventListener('selectionchange', checkSelection)
  }, [checkSelection])

  if (!state.visible) return null

  function exec(command: string, value?: string) {
    document.execCommand(command, false, value)
    checkSelection()
  }

  function toggleLink() {
    const sel = window.getSelection()
    if (state.link) {
      document.execCommand('unlink')
    } else {
      const url = prompt('Link URL:')
      if (url) document.execCommand('createLink', false, url)
    }
    checkSelection()
  }

  const btnCls = (active: boolean) => [
    'p-1.5 rounded transition-colors',
    active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-foreground',
  ].join(' ')

  return (
    <div
      ref={toolbarRef}
      className="absolute z-50 flex items-center gap-0.5 rounded-lg border bg-popover shadow-lg px-1 py-0.5 -translate-x-1/2 -translate-y-full"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(e) => e.preventDefault()} // Prevent stealing focus from contenteditable
    >
      <button type="button" className={btnCls(state.bold)} onClick={() => exec('bold')} title="Bold (⌘B)">
        <BoldIcon className="size-3.5" />
      </button>
      <button type="button" className={btnCls(state.italic)} onClick={() => exec('italic')} title="Italic (⌘I)">
        <ItalicIcon className="size-3.5" />
      </button>
      <button type="button" className={btnCls(state.underline)} onClick={() => exec('underline')} title="Underline (⌘U)">
        <UnderlineIcon className="size-3.5" />
      </button>
      <button type="button" className={btnCls(state.strikethrough)} onClick={() => exec('strikeThrough')} title="Strikethrough">
        <StrikethroughIcon className="size-3.5" />
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button type="button" className={btnCls(state.link)} onClick={toggleLink} title={state.link ? 'Unlink' : 'Link (⌘K)'}>
        {state.link ? <UnlinkIcon className="size-3.5" /> : <LinkIcon className="size-3.5" />}
      </button>
    </div>
  )
}

function findParentAnchor(node: Node | null): HTMLAnchorElement | null {
  while (node) {
    if (node instanceof HTMLAnchorElement) return node
    node = node.parentNode
  }
  return null
}
```

**Step 2: Wire into ContentEditor**

Add to `ContentEditor.tsx`: wrap the block list in a `<div ref={containerRef} className="relative">` and render `<InlineToolbar containerRef={containerRef} />` inside it.

**Step 3: Commit**

```bash
git add packages/panels/pages/_components/content-blocks/InlineToolbar.tsx
git add packages/panels/pages/_components/ContentEditor.tsx
git commit -m "feat(panels): add floating inline formatting toolbar"
```

---

### Task C6: Image, Divider, Code, Quote, List Blocks

**Files:**
- Create: `packages/panels/pages/_components/content-blocks/ImageBlock.tsx`
- Create: `packages/panels/pages/_components/content-blocks/DividerBlock.tsx`
- Create: `packages/panels/pages/_components/content-blocks/CodeBlock.tsx`
- Create: `packages/panels/pages/_components/content-blocks/ListBlock.tsx`

**Step 1: Create each block component**

**ImageBlock.tsx:**
```tsx
import { useState } from 'react'

interface Props {
  src: string; alt: string; caption: string
  onChange: (patch: Record<string, unknown>) => void
  uploadBase?: string; disabled?: boolean
}

export function ImageBlock({ src, alt, caption, onChange, uploadBase, disabled }: Props) {
  const [uploading, setUploading] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !uploadBase) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('disk', 'public')
      form.append('directory', 'content')
      const res  = await fetch(`${uploadBase}/_upload`, { method: 'POST', body: form })
      const data = await res.json() as { url: string }
      onChange({ src: data.url, alt: file.name })
    } finally { setUploading(false) }
  }

  if (!src) {
    return (
      <label className="flex flex-col items-center gap-2 py-8 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/30 transition-colors text-muted-foreground">
        <span className="text-sm">{uploading ? 'Uploading…' : 'Click to upload image'}</span>
        <input type="file" accept="image/*" onChange={handleFile} className="hidden" disabled={disabled || uploading} />
      </label>
    )
  }

  return (
    <figure className="flex flex-col gap-2">
      <img src={src} alt={alt} className="rounded-lg max-h-96 object-contain mx-auto" />
      {!disabled && (
        <input
          type="text"
          value={caption}
          onChange={(e) => onChange({ caption: e.target.value })}
          placeholder="Add a caption…"
          className="text-sm text-center text-muted-foreground bg-transparent border-none outline-none"
        />
      )}
    </figure>
  )
}
```

**DividerBlock.tsx:**
```tsx
export function DividerBlock() {
  return <hr className="my-2 border-border" />
}
```

**CodeBlock.tsx:**
```tsx
interface Props {
  code: string; language: string
  onChange: (patch: Record<string, unknown>) => void
  disabled?: boolean
}

export function CodeBlock({ code, language, onChange, disabled }: Props) {
  return (
    <div className="rounded-lg border bg-muted/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
        <input
          type="text"
          value={language}
          onChange={(e) => onChange({ language: e.target.value })}
          placeholder="language"
          className="text-xs bg-transparent border-none outline-none text-muted-foreground w-24"
          disabled={disabled}
        />
      </div>
      <textarea
        value={code}
        onChange={(e) => onChange({ code: e.target.value })}
        className="w-full p-3 text-sm font-mono bg-transparent resize-none outline-none min-h-[80px]"
        disabled={disabled}
        spellCheck={false}
      />
    </div>
  )
}
```

**ListBlock.tsx:**
```tsx
interface Props {
  style: 'bullet' | 'numbered'
  items: string[]
  onChange: (patch: Record<string, unknown>) => void
  disabled?: boolean
}

export function ListBlock({ style, items, onChange, disabled }: Props) {
  function updateItem(index: number, text: string) {
    onChange({ items: items.map((t, i) => i === index ? text : t) })
  }
  function addItem() {
    onChange({ items: [...items, ''] })
  }
  function removeItem(index: number) {
    if (items.length <= 1) return
    onChange({ items: items.filter((_, i) => i !== index) })
  }
  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addItem() }
    if (e.key === 'Backspace' && items[index] === '' && items.length > 1) {
      e.preventDefault(); removeItem(index)
    }
  }

  const Tag = style === 'numbered' ? 'ol' : 'ul'

  return (
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={() => onChange({ style: style === 'bullet' ? 'numbered' : 'bullet' })}
        className="text-xs text-muted-foreground hover:text-foreground mt-1.5 shrink-0"
        disabled={disabled}
      >
        {style === 'bullet' ? '•' : '1.'}
      </button>
      <Tag className={`flex-1 flex flex-col gap-1 ${style === 'numbered' ? 'list-decimal' : 'list-disc'} pl-5`}>
        {items.map((item, i) => (
          <li key={i}>
            <input
              type="text"
              value={item}
              onChange={(e) => updateItem(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="w-full bg-transparent outline-none text-sm py-0.5"
              placeholder="List item…"
              disabled={disabled}
            />
          </li>
        ))}
      </Tag>
    </div>
  )
}
```

**Step 2: Wire ListBlock into ContentEditor's renderBlock**

Add the list case:
```tsx
case 'list':
  return <ListBlock style={(block.style as 'bullet' | 'numbered') ?? 'bullet'} items={Array.isArray(block.items) ? (block.items as string[]) : ['']} onChange={update} disabled={disabled} />
```

**Step 3: Commit**

```bash
git add packages/panels/pages/_components/content-blocks/
git add packages/panels/pages/_components/ContentEditor.tsx
git commit -m "feat(panels): add Image, Divider, Code, Quote, List block components"
```

---

### Task C7: Block Picker (Button + Grouped Menu)

**Files:**
- Create: `packages/panels/pages/_components/content-blocks/BlockPicker.tsx`

The block picker shows as:
1. A `+` button (between blocks / at bottom)
2. A slash command menu (type `/` in an empty paragraph)

**Step 1: Create the picker**

```tsx
// packages/panels/pages/_components/content-blocks/BlockPicker.tsx
import { useState, useRef, useEffect } from 'react'
import { icons } from 'lucide-react'
import type { ContentBlockDef } from '@boostkit/panels'

interface Props {
  defs:      ContentBlockDef[]
  onSelect:  (type: string) => void
  trigger:   'empty' | 'between' | 'bottom' | 'slash'
  placeholder?: string
  filter?:   string
}

export function BlockPicker({ defs, onSelect, trigger, placeholder, filter }: Props) {
  const [open, setOpen] = useState(trigger === 'slash')
  const [search, setSearch] = useState(filter ?? '')
  const ref = useRef<HTMLDivElement>(null)

  const filtered = defs.filter(d =>
    !search || d.label.toLowerCase().includes(search.toLowerCase()) || d.type.includes(search.toLowerCase())
  )

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (trigger === 'empty') {
    return (
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? (
          <div ref={ref} className="text-left">
            <BlockList defs={filtered} onSelect={(t) => { onSelect(t); setOpen(false) }} />
          </div>
        ) : (
          placeholder || 'Click to add content…'
        )}
      </button>
    )
  }

  if (trigger === 'between') {
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="h-5 w-5 rounded-full border bg-background text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors flex items-center justify-center"
        >+</button>
        {open && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-30">
            <BlockList defs={filtered} onSelect={(t) => { onSelect(t); setOpen(false) }} />
          </div>
        )}
      </div>
    )
  }

  // bottom
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-4 py-2 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <span className="text-base leading-none">+</span>
        Add block
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-30">
          <BlockList defs={filtered} onSelect={(t) => { onSelect(t); setOpen(false) }} />
        </div>
      )}
    </div>
  )
}

function BlockList({ defs, onSelect }: { defs: ContentBlockDef[]; onSelect: (type: string) => void }) {
  // Group by category
  const groups = new Map<string, ContentBlockDef[]>()
  for (const d of defs) {
    const g = groups.get(d.group) ?? []
    g.push(d)
    groups.set(d.group, g)
  }

  return (
    <div className="w-56 rounded-lg border bg-popover shadow-lg py-1 overflow-hidden">
      {[...groups.entries()].map(([group, items]) => (
        <div key={group}>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-3 pt-2 pb-1">{group}</p>
          {items.map((def) => {
            const Icon = (icons as Record<string, React.ComponentType<{ className?: string }>>)[toPascal(def.icon)]
            return (
              <button
                key={def.type}
                type="button"
                onClick={() => onSelect(def.type)}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left"
              >
                {Icon ? <Icon className="size-4 text-muted-foreground" /> : <span className="size-4" />}
                <span>{def.label}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function toPascal(s: string): string {
  return s.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())
}
```

**Step 2: Commit**

```bash
git add packages/panels/pages/_components/content-blocks/BlockPicker.tsx
git commit -m "feat(panels): add block picker with grouped categories"
```

---

### Task C8: Wire ContentField into FieldInput

**Files:**
- Modify: `packages/panels/pages/_components/FieldInput.tsx`

**Step 1: Add static import and content case**

At top of FieldInput.tsx, add:
```tsx
import { ContentEditor } from './ContentEditor.js'
```

In the function body, before the custom renderer check (~line 617):
```tsx
// ── Content ─────────────────────────────────────────────
if (field.type === 'content') {
  const allowedBlocks = field.extra?.blockTypes as string[] | undefined
  const placeholder   = field.extra?.placeholder as string | undefined
  const maxBlocks     = field.extra?.maxBlocks as number | undefined
  return (
    <ContentEditor
      value={value as NodeMap}
      onChange={onChange}
      allowedBlocks={allowedBlocks}
      placeholder={placeholder}
      maxBlocks={maxBlocks}
      uploadBase={uploadBase}
      disabled={isDisabled}
    />
  )
}
```

**Step 2: Commit**

```bash
git add packages/panels/pages/_components/FieldInput.tsx
git commit -m "feat(panels): wire ContentField into FieldInput renderer"
```

---

### Task C9: Read-Only ContentRenderer

**Files:**
- Create: `packages/panels/pages/_components/ContentRenderer.tsx`
- Modify: `packages/panels/pages/_components/CellValue.tsx`

Used on show pages to render content blocks as static HTML, and in table cells as a text preview.

**Step 1: Create the renderer**

```tsx
// packages/panels/pages/_components/ContentRenderer.tsx
import type { NodeMap, NodeData } from '@boostkit/panels'
import { ensureNodeMap } from '@boostkit/panels'

interface Props {
  value: unknown  // NodeMap or legacy array
  className?: string
}

export function ContentRenderer({ value, className }: Props) {
  const map = ensureNodeMap(value)
  const root = map.ROOT
  if (!root || root.nodes.length === 0) {
    return <span className="text-muted-foreground text-sm">—</span>
  }

  return (
    <div className={['prose prose-sm dark:prose-invert max-w-none', className].filter(Boolean).join(' ')}>
      {root.nodes.map((id) => {
        const node = map[id]
        return node ? <NodeView key={id} node={node} /> : null
      })}
    </div>
  )
}

function NodeView({ node }: { node: NodeData }) {
  const p = node.props
  switch (node.type) {
    case 'paragraph':
      return <p dangerouslySetInnerHTML={{ __html: (p.text as string) || '' }} />
    case 'heading': {
      const Tag = `h${p.level ?? 2}` as 'h1' | 'h2' | 'h3'
      return <Tag dangerouslySetInnerHTML={{ __html: (p.text as string) || '' }} />
    }
    case 'quote':
      return <blockquote dangerouslySetInnerHTML={{ __html: (p.text as string) || '' }} />
    case 'image':
      return (
        <figure>
          <img src={p.src as string} alt={(p.alt as string) ?? ''} />
          {p.caption && <figcaption>{p.caption as string}</figcaption>}
        </figure>
      )
    case 'code':
      return (
        <pre><code className={p.language ? `language-${p.language}` : ''}>
          {p.code as string}
        </code></pre>
      )
    case 'divider':
      return <hr />
    case 'list': {
      const Tag = (p.style as string) === 'numbered' ? 'ol' : 'ul'
      return (
        <Tag>
          {(Array.isArray(p.items) ? p.items : []).map((item, i) => (
            <li key={i}>{item as string}</li>
          ))}
        </Tag>
      )
    }
    default:
      return null
  }
}
```

**Step 2: Wire into CellValue for table preview**

In `packages/panels/pages/_components/CellValue.tsx`, add a case for `content` and `builder` types that use NodeMap:

```tsx
if (type === 'content' || type === 'builder') {
  const map = ensureNodeMap(value)
  const root = map.ROOT
  if (!root || root.nodes.length === 0) return <span className="text-muted-foreground">—</span>

  if (type === 'content') {
    // Find first text block and show as preview
    const firstTextId = root.nodes.find(id => {
      const n = map[id]
      return n && (n.type === 'paragraph' || n.type === 'heading')
    })
    const text = firstTextId ? ((map[firstTextId]?.props.text as string) ?? '').replace(/<[^>]*>/g, '') : ''
    return <span className="truncate max-w-[300px] block">{text || '—'}</span>
  }

  // Builder: show block count
  return <span className="text-muted-foreground">{root.nodes.length} block{root.nodes.length !== 1 ? 's' : ''}</span>
}
```

**Step 3: Commit**

```bash
git add packages/panels/pages/_components/ContentRenderer.tsx
git add packages/panels/pages/_components/CellValue.tsx
git commit -m "feat(panels): add ContentRenderer and NodeMap-aware CellValue"
```

---

## Phase D: Integration

### Task D1: Yjs Collaborative Binding for NodeMap Fields

**Files:**
- Modify: `packages/panels/pages/_hooks/useCollaborativeForm.ts`

The existing `useCollaborativeForm` syncs fields as plain values via `fieldsMap.set(name, value)`. For NodeMap fields (builder + content), this already works — the entire NodeMap is serialized as a JSON-like object in the Y.Map.

**Phase 1 (this plan):** NodeMap synced as whole-value replacement via existing `useCollaborativeForm`. When User A changes a block, the entire NodeMap is written to `fieldsMap.set('content', nodeMap)`. This is functional and sufficient for initial launch.

**Phase 2 (future plan, NOT this task):** Upgrade to nested Yjs types:
```
Y.Map('content') → per-node Y.Map → per-text-prop Y.Text
```
This enables character-level CRDT merge for text blocks and conflict-free concurrent reorder + edit. The flat node map data model makes this upgrade straightforward — each node ID becomes a key in a Y.Map, and the `nodes` array becomes a Y.Array.

**Step 1: No code changes needed for Phase 1**

The existing `useCollaborativeForm` already handles this. NodeMap is a plain object that serializes to Y.Map values correctly.

Verify by testing:
1. Open article edit in two tabs
2. Edit a Builder or Content field in tab A
3. Confirm tab B updates

**Step 2: Commit (docs only if adding comments)**

```bash
git commit --allow-empty -m "docs(panels): document NodeMap Yjs sync strategy (Phase 1: whole-value)"
```

---

### Task D2: Playground Demo

**Files:**
- Modify: `playground/app/Panels/Admin/resources/ArticleResource.ts`
- Possibly: `playground/prisma/schema.prisma`

**Step 1: Add ContentField to ArticleResource**

```ts
import { ContentField } from '@boostkit/panels'

// In fields() method, add to the appropriate Section:
ContentField.make('content')
  .label('Content')
  .placeholder('Start writing…')
  .collaborative(),
```

**Step 2: Add content column to Article model if needed**

Check if Article already has a `content` column. If not, add to `prisma/schema.prisma`:

```prisma
model Article {
  // ... existing fields ...
  content Json?
}
```

Then:
```bash
cd playground && pnpm exec prisma db push
```

**Step 3: Commit**

```bash
git add playground/app/Panels/Admin/resources/ArticleResource.ts
git add playground/prisma/schema.prisma
git commit -m "feat(playground): add ContentField to ArticleResource"
```

---

### Task D3: Sync to Playground + Full Smoke Test

**Step 1: Copy panel pages to playground**

```bash
cp -r packages/panels/pages/_components/ playground/pages/\(panels\)/_components/
cp -r packages/panels/pages/_hooks/ playground/pages/\(panels\)/_hooks/
cp -r packages/panels/pages/@panel/ playground/pages/\(panels\)/@panel/
```

**Step 2: Build and run**

```bash
cd packages/panels && pnpm build
cd ../../playground && pnpm dev
```

**Step 3: Builder field smoke test**

- [ ] Navigate to article with existing Builder field data — loads correctly (array→NodeMap migration)
- [ ] Add a new block — appears at bottom
- [ ] Drag block to reorder — dnd-kit handle works
- [ ] Edit block fields — values update
- [ ] Remove a block — disappears
- [ ] Save — NodeMap stored as JSON in DB
- [ ] Reload — NodeMap loads correctly

**Step 4: Content field smoke test**

- [ ] Navigate to `/admin/articles/create` — ContentField renders empty state with "Start writing…"
- [ ] Click to add a paragraph block — contenteditable div appears
- [ ] Type text, select it — inline toolbar appears with B/I/U/Link buttons
- [ ] Bold some text — `<b>` tag wraps selection
- [ ] Add a heading block — heading level selector + editable text
- [ ] Add an image block — upload works, image displays
- [ ] Add a code block — monospace textarea renders
- [ ] Add a divider — horizontal rule shows
- [ ] Drag blocks to reorder — drag handle works
- [ ] Save the article — NodeMap stored as JSON in DB
- [ ] View article show page — ContentRenderer displays blocks as formatted HTML
- [ ] Table page — first paragraph shows as text preview

**Step 5: Collaborative smoke test (if versioned)**

- [ ] Open same article in two tabs
- [ ] Edit Builder field in tab A — tab B updates
- [ ] Edit Content field in tab A — tab B updates

**Step 6: Commit**

```bash
git add playground/pages/
git commit -m "feat(playground): sync all block editor components"
```

---

## Summary

### Phase A — Shared Infrastructure
| Task | Files | Purpose |
|------|-------|---------|
| A1 | `NodeMap.ts` | Flat node map types + pure helpers (add/remove/move/reorder/migrate) |
| A2 | `SortableBlockList.tsx` | Shared dnd-kit sortable wrapper |
| A3 | `index.ts` | Export NodeMap from panels |

### Phase B — Repeater + Builder Field Upgrade
| Task | Files | Purpose |
|------|-------|---------|
| B1 | `FieldInput.tsx` (repeater section) | Migrate Repeater to NodeMap + SortableBlockList |
| B2 | `FieldInput.tsx` (builder section) | Migrate Builder to NodeMap + SortableBlockList |
| B3 | `PanelServiceProvider.ts` | Ensure coercePayload handles NodeMap |
| B4 | Playground sync | Verify backward compat + drag reorder for both |

### Phase C — Content Field
| Task | Files | Purpose |
|------|-------|---------|
| C1 | `ContentField.ts` + `index.ts` | Backend field class + exports |
| C2 | `ContentBlock.ts` | Content block type registry |
| C3 | `ContentEditor.tsx` | Main editor using NodeMap + SortableBlockList |
| C4 | `RichTextBlock.tsx` | Contenteditable with inline formatting |
| C5 | `InlineToolbar.tsx` | Floating format toolbar |
| C6 | `ImageBlock/Divider/Code/List` | Non-text block components |
| C7 | `BlockPicker.tsx` | Block type selector UI |
| C8 | `FieldInput.tsx` | Wire content field |
| C9 | `ContentRenderer.tsx` + `CellValue.tsx` | Read-only display |

### Phase D — Integration
| Task | Files | Purpose |
|------|-------|---------|
| D1 | (no changes) | Verify Yjs sync works with NodeMap |
| D2 | `ArticleResource.ts` + schema | Playground demo |
| D3 | Playground sync | Full smoke test |
