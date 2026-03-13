import { useRef, useCallback, useState, useEffect } from 'react'
import type { ContentBlockDef, NodeData, NodeMap } from '@boostkit/panels'
import { contentBlockDefs, ensureNodeMap, addNode, updateNodeProps, removeNode, removeNodeRecursive, reorderNode } from '@boostkit/panels'
import { useCrossBlockSelection } from '../_hooks/useCrossBlockSelection.js'
import { RichTextBlock } from './content-blocks/RichTextBlock.js'
import { ImageBlock } from './content-blocks/ImageBlock.js'
import { CodeBlock } from './content-blocks/CodeBlock.js'
import { DividerBlock } from './content-blocks/DividerBlock.js'
import { ListBlock } from './content-blocks/ListBlock.js'
import { TableBlock } from './content-blocks/TableBlock.js'
import { BlockPicker } from './content-blocks/BlockPicker.js'
import { InlineToolbar } from './content-blocks/InlineToolbar.js'
import { SlashCommandMenu, filteredCount, filteredTypeAt } from './content-blocks/SlashCommandMenu.js'
import { SortableBlockList } from './SortableBlockList.js'

const defaultBlockProps: Record<string, Record<string, unknown>> = {
  paragraph: { text: '' },
  heading:   { text: '', level: 2 },
  image:     { src: '', alt: '', caption: '' },
  divider:   {},
  code:      { code: '', language: '' },
  quote:     { text: '' },
  list:      { style: 'bullet' },
  table:     { rows: 2, cols: 2 },
}

/** Block types that have a text prop and use RichTextBlock */
const TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading', 'quote'])

/** Block types that are containers (have children managed via NodeMap) */
const CONTAINER_BLOCK_TYPES = new Set(['table', 'list', 'table-cell', 'list-item'])

interface SlashState {
  blockId: string
  parentId: string
  position: { top: number; left: number }
  query: string
  selectedIndex: number
}

interface Props {
  value:          unknown
  onChange:       (value: NodeMap) => void
  allowedBlocks?: string[]
  placeholder?:   string
  maxBlocks?:     number
  uploadBase?:    string
  disabled?:      boolean
  /** Y.Doc for creating per-block Y.Text instances (optional) */
  yDoc?:          any | null
  /** Awareness for cursor broadcasting (optional) */
  awareness?:     any | null
  /** True after Y.Doc initial sync completes — block Y.Text seeding deferred until true */
  yDocSynced?:    boolean
}

export function ContentEditor({ value: rawValue, onChange, allowedBlocks, placeholder, maxBlocks, uploadBase, disabled, yDoc, awareness, yDocSynced }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const value   = ensureNodeMap(rawValue)
  const root    = value.ROOT!
  const nodeIds = root.nodes
  const defs    = contentBlockDefs.filter(d => !allowedBlocks || allowedBlocks.includes(d.type))
  const atMax   = maxBlocks !== undefined && nodeIds.length >= maxBlocks

  // Cross-block text selection
  const { handleMouseDown: handleCrossBlockMouseDown, getBlockHighlight } = useCrossBlockSelection(nodeIds)

  // Slash command state
  const [slashState, setSlashState] = useState<SlashState | null>(null)

  /** Track which block Y.Text instances have been seeded */
  const seededBlocksRef = useRef<Set<string>>(new Set())

  /** Get or create a Y.Text for a specific block node, seeding initial content if needed.
   *  Seeding is deferred until yDocSynced is true to prevent CRDT merge duplication. */
  const getBlockYText = useCallback((nodeId: string, initialText?: string) => {
    if (!yDoc) return null
    const yText = yDoc.getText(`block:${nodeId}`)
    // Only seed AFTER initial sync — seeding before sync causes CRDT merge duplication
    if (yDocSynced && !seededBlocksRef.current.has(nodeId) && yText.length === 0 && initialText) {
      yText.insert(0, initialText)
      seededBlocksRef.current.add(nodeId)
    } else {
      seededBlocksRef.current.add(nodeId)
    }
    return yText
  }, [yDoc, yDocSynced])

  // ── Structural sync via Y.Map ──────────────────────────────
  // Syncs add/remove/reorder of blocks across users.
  // Text content for text blocks is NOT included (handled by per-block Y.Text).
  const lastSyncedFingerprintRef = useRef('')
  const suppressStructuralObserverRef = useRef(false)
  /** True after we've applied the initial remote structure (or confirmed none exists).
   *  Prevents the local→Y.Map sync from overwriting remote state with stale DB values on refresh. */
  const initialStructureAppliedRef = useRef(false)

  /** Fingerprint that changes only on structural changes, not text edits */
  function structuralFingerprint(map: NodeMap): string {
    const keys = Object.keys(map).sort()
    return keys.map(k => {
      const n = map[k]
      if (!n) return ''
      const props = TEXT_BLOCK_TYPES.has(n.type)
        ? Object.entries(n.props).filter(([k]) => k !== 'text').map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('&')
        : JSON.stringify(n.props)
      return `${k}:${n.type}:${n.parent}:[${n.nodes.join(',')}]:${props}`
    }).join('|')
  }

  // Sync local structural changes → Y.Map
  // Gated by initialStructureAppliedRef to avoid overwriting remote state with stale DB on refresh.
  useEffect(() => {
    if (!yDoc || !yDocSynced || !initialStructureAppliedRef.current) return

    const fp = structuralFingerprint(value)
    if (fp === lastSyncedFingerprintRef.current) return
    lastSyncedFingerprintRef.current = fp

    const structMap = yDoc.getMap('content:structure')
    const stripped: Record<string, unknown> = {}
    for (const [id, node] of Object.entries(value)) {
      if (!node) continue
      const props = TEXT_BLOCK_TYPES.has(node.type)
        ? Object.fromEntries(Object.entries(node.props).filter(([k]) => k !== 'text'))
        : node.props
      stripped[id] = { type: node.type, props, parent: node.parent, nodes: [...node.nodes] }
    }
    suppressStructuralObserverRef.current = true
    structMap.set('map', JSON.stringify(stripped))
  }) // runs every render, fingerprint check prevents unnecessary Y.Map writes

  // Observe remote structural changes → update local NodeMap
  useEffect(() => {
    if (!yDoc || !yDocSynced) return
    const structMap = yDoc.getMap('content:structure')

    // On initial sync: if Y.Map has structure, it's the source of truth (may have unsaved blocks).
    // If no remote structure exists, the DB value is correct — mark as applied so local sync can start.
    const initial = structMap.get('map') as string | undefined
    if (initial) {
      const remote = JSON.parse(initial) as Record<string, NodeData>
      lastSyncedFingerprintRef.current = structuralFingerprint(remote as NodeMap)
      mergeRemoteStructure(remote)
    } else {
      // No remote structure yet — seed Y.Map from current DB-loaded value
      lastSyncedFingerprintRef.current = structuralFingerprint(value)
    }
    initialStructureAppliedRef.current = true

    function handler(_event: any, transaction: any) {
      if (suppressStructuralObserverRef.current) {
        suppressStructuralObserverRef.current = false
        return
      }
      if (transaction.local) return
      const raw = structMap.get('map') as string | undefined
      if (!raw) return
      const remote = JSON.parse(raw) as Record<string, NodeData>
      lastSyncedFingerprintRef.current = structuralFingerprint(remote as NodeMap)
      mergeRemoteStructure(remote)
    }

    structMap.observe(handler)
    return () => structMap.unobserve(handler)
  }, [yDoc, yDocSynced]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Walk text nodes to convert a flat char index → { node, offset } in the DOM */
  function indexToNodeOffset(root: Node, target: number): { node: Node; offset: number } | null {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let count = 0
    while (walker.nextNode()) {
      const len = walker.currentNode.textContent!.length
      if (count + len >= target) return { node: walker.currentNode, offset: target - count }
      count += len
    }
    if (root.childNodes.length === 0) return { node: root, offset: 0 }
    return null
  }

  /** Walk text nodes to convert a DOM { node, offset } → flat char index */
  function nodeOffsetToIndex(root: Node, targetNode: Node, offset: number): number {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let count = 0
    while (walker.nextNode()) {
      if (walker.currentNode === targetNode) return count + offset
      count += walker.currentNode.textContent!.length
    }
    return count
  }

  /** Merge remote NodeMap structure with Y.Text content for text blocks.
   *  Preserves the active selection across the DOM reorder. */
  function mergeRemoteStructure(remote: Record<string, NodeData>) {
    // Save selection as block ID + text offsets (stable across DOM moves)
    let savedSel: { blockId: string; start: number; end: number } | null = null
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      const ce = (range.startContainer as HTMLElement).closest?.('[contenteditable]')
        ?? (range.startContainer.parentElement?.closest('[contenteditable]'))
      const blockEl = ce?.closest('[data-block-id]')
      if (ce && blockEl) {
        const blockId = blockEl.getAttribute('data-block-id')!
        savedSel = {
          blockId,
          start: nodeOffsetToIndex(ce, range.startContainer, range.startOffset),
          end:   nodeOffsetToIndex(ce, range.endContainer, range.endOffset),
        }
      }
    }

    const merged: NodeMap = {}
    for (const [id, node] of Object.entries(remote)) {
      if (!node) continue
      if (TEXT_BLOCK_TYPES.has(node.type)) {
        const yText = yDoc!.getText(`block:${id}`)
        merged[id] = { ...node, props: { ...node.props, text: yText.toString() } }
      } else {
        merged[id] = node
      }
    }
    onChange(merged)

    // Restore selection by finding the block fresh in the post-render DOM
    if (savedSel) {
      const { blockId, start, end } = savedSel
      requestAnimationFrame(() => {
        const blockEl = document.querySelector(`[data-block-id="${blockId}"]`)
        const ce = blockEl?.querySelector('[contenteditable]') as HTMLElement
        if (!ce) return
        ce.focus({ preventScroll: true })
        const startPos = indexToNodeOffset(ce, start)
        const endPos   = indexToNodeOffset(ce, end)
        if (!startPos || !endPos) return
        const s = window.getSelection()
        if (!s) return
        const range = document.createRange()
        range.setStart(startPos.node, startPos.offset)
        range.setEnd(endPos.node, endPos.offset)
        s.removeAllRanges()
        s.addRange(range)
      })
    }
  }

  function handleAddBlock(type: string, atIndex?: number, parentId?: string) {
    const props = defaultBlockProps[type]
    if (!props || atMax) return
    const parent = parentId ?? 'ROOT'
    const { map, id } = addNode(value, type, { ...props }, parent, atIndex)
    onChange(map)
    return id
  }

  function handleUpdateNode(id: string, propsPatch: Record<string, unknown>) {
    onChange(updateNodeProps(value, id, propsPatch))
  }

  function handleRemoveNode(id: string) {
    const node = value[id]
    if (node && node.nodes.length > 0) {
      onChange(removeNodeRecursive(value, id))
    } else {
      onChange(removeNode(value, id))
    }
  }

  /** Reorder blocks within the root container */
  function handleReorder(fromIndex: number, toIndex: number) {
    const id = nodeIds[fromIndex]
    if (!id) return
    onChange(reorderNode(value, id, fromIndex, toIndex))
  }

  /** Called when "/" is typed in an empty text block */
  function handleSlashCommand(blockId: string, parentId: string, position: { top: number; left: number }) {
    setSlashState({ blockId, parentId, position, query: '', selectedIndex: 0 })
  }

  /** Handle slash command selection by type */
  function handleSlashSelectType(type: string) {
    if (!slashState) return
    const { blockId, parentId } = slashState
    const node = value[blockId]
    if (!node) { setSlashState(null); return }

    const parent = value[parentId]
    if (!parent) { setSlashState(null); return }

    // If slash was triggered inside a list-item, handle specially
    if (node.type === 'list-item') {
      if (type === 'list') {
        // "/" → list inside a list item = create a sublist
        const existingSublist = node.nodes.find(id => value[id]?.type === 'list')
        if (!existingSublist) {
          let map = { ...value }
          const subResult = addNode(map, 'list', { style: 'bullet' }, blockId)
          map = subResult.map
          const itemResult = addNode(map, 'list-item', { text: '' }, subResult.id)
          map = itemResult.map
          map[blockId] = { ...map[blockId]!, props: { ...map[blockId]!.props, text: '' } }
          onChange(map)
          requestAnimationFrame(() => {
            const el = document.querySelector(`[data-list-item-id="${itemResult.id}"] [contenteditable]`) as HTMLElement
            el?.focus()
          })
        }
      } else {
        // Other block types: insert the new block AFTER the parent list in the root,
        // then remove this list item (if it's the only one, remove the whole list)
        const listNode = value[parentId]
        if (!listNode) { setSlashState(null); return }
        const listParentId = listNode.parent
        const listParent = value[listParentId]
        if (!listParent) { setSlashState(null); return }

        const listIndex = listParent.nodes.indexOf(parentId)
        let map = { ...value }

        // Remove this list item
        if (listNode.nodes.length <= 1) {
          // Only item in the list — remove the entire list block
          map = removeNodeRecursive(map, parentId)
        } else {
          // Remove just this item
          if (node.nodes.length > 0) {
            map = removeNodeRecursive(map, blockId)
          } else {
            map = removeNode(map, blockId)
          }
        }

        // Insert the new block type after where the list was/is
        const props = defaultBlockProps[type]
        if (props) {
          const insertIdx = listNode.nodes.length <= 1 ? listIndex : listIndex + 1
          const result = addNode(map, type, { ...props }, listParentId, insertIdx)
          map = result.map
          onChange(map)
          requestAnimationFrame(() => {
            const newBlockEl = document.querySelector(`[data-block-id="${result.id}"] [contenteditable]`) as HTMLElement
            newBlockEl?.focus()
          })
        } else {
          onChange(map)
        }
      }
      clearSlashText(blockId)
      setSlashState(null)
      return
    }

    const blockIndex = parent.nodes.indexOf(blockId)

    if (type === node.type) {
      clearSlashText(blockId)
      setSlashState(null)
      return
    }

    // Remove old block and add new one at the same index
    let map: NodeMap
    if (node.nodes.length > 0) {
      map = removeNodeRecursive(value, blockId)
    } else {
      map = removeNode(value, blockId)
    }

    const props = defaultBlockProps[type]
    if (props) {
      const result = addNode(map, type, { ...props }, parentId, blockIndex)
      map = result.map
      // For list blocks, focus happens after legacy migration creates items (needs extra frame)
      if (type === 'list') {
        onChange(map)
        setSlashState(null)
        // Wait for migration to create list-items, then focus the first one
        setTimeout(() => {
          const listEl = document.querySelector(`[data-block-id="${result.id}"]`)
          const firstItem = listEl?.querySelector('[contenteditable]') as HTMLElement
          firstItem?.focus()
        }, 50)
        return
      }
      requestAnimationFrame(() => {
        const newBlockEl = document.querySelector(`[data-block-id="${result.id}"] [contenteditable]`) as HTMLElement
        newBlockEl?.focus()
      })
    }

    onChange(map)
    setSlashState(null)
  }

  /** Get the defs relevant to the current slash context */
  function slashDefs(): ContentBlockDef[] {
    if (slashState?.blockId && value[slashState.blockId]?.type === 'list-item') {
      return defs.filter(d => d.type !== 'paragraph')
    }
    return defs
  }

  /** Handle Enter in slash menu — select the currently highlighted item */
  function handleSlashSelectCurrent() {
    if (!slashState) return
    const type = filteredTypeAt(slashDefs(), slashState.query, slashState.selectedIndex)
    if (type) handleSlashSelectType(type)
    else setSlashState(null)
  }

  /** Navigate slash menu up/down */
  function handleSlashNavigate(delta: number) {
    if (!slashState) return
    const count = filteredCount(slashDefs(), slashState.query)
    if (count === 0) return
    setSlashState(prev => {
      if (!prev) return prev
      const newIdx = Math.max(0, Math.min(prev.selectedIndex + delta, count - 1))
      return { ...prev, selectedIndex: newIdx }
    })
  }

  /** Update slash filter query */
  function handleSlashQueryChange(query: string) {
    setSlashState(prev => prev ? { ...prev, query, selectedIndex: 0 } : prev)
  }

  /** Close slash menu and clear typed filter text */
  function handleSlashClose() {
    setSlashState(null)
  }

  /** Clear the filter text typed in the block's contenteditable */
  function clearSlashText(blockId: string) {
    requestAnimationFrame(() => {
      const el = (
        document.querySelector(`[data-block-id="${blockId}"] [contenteditable]`) ??
        document.querySelector(`[data-list-item-id="${blockId}"] [contenteditable]`)
      ) as HTMLElement
      if (el) {
        el.innerHTML = ''
      }
    })
  }

  /** Called on double Enter — create new paragraph block after the current one and focus it */
  function handleNewBlockAfter(blockId: string, parentId: string) {
    const parent = value[parentId]
    if (!parent || atMax) return
    const blockIndex = parent.nodes.indexOf(blockId)
    if (blockIndex === -1) return

    const props = defaultBlockProps['paragraph']
    if (!props) return
    const { map, id: newId } = addNode(value, 'paragraph', { ...props }, parentId, blockIndex + 1)
    onChange(map)

    requestAnimationFrame(() => {
      const newBlockEl = document.querySelector(`[data-block-id="${newId}"] [contenteditable]`) as HTMLElement
      newBlockEl?.focus()
    })
  }

  /** Called on Backspace in empty paragraph — delete it and focus previous block */
  function handleDeleteBlock(blockId: string, parentId: string) {
    const parent = value[parentId]
    if (!parent) return
    const blockIndex = parent.nodes.indexOf(blockId)

    // Find previous sibling to focus
    const prevId = blockIndex > 0 ? parent.nodes[blockIndex - 1] : null

    const node = value[blockId]
    let map: NodeMap
    if (node && node.nodes.length > 0) {
      map = removeNodeRecursive(value, blockId)
    } else {
      map = removeNode(value, blockId)
    }
    onChange(map)

    if (prevId) {
      requestAnimationFrame(() => {
        const prevEl = document.querySelector(`[data-block-id="${prevId}"] [contenteditable]`) as HTMLElement
        if (prevEl) {
          prevEl.focus()
          // Place caret at end
          const sel = window.getSelection()
          if (sel) {
            const range = document.createRange()
            range.selectNodeContents(prevEl)
            range.collapse(false)
            sel.removeAllRanges()
            sel.addRange(range)
          }
        }
      })
    }
  }

  /** Render any block node — used recursively by container blocks */
  function renderBlockNode(
    node: NodeData,
    nodeId: string,
    updateProps: (patch: Record<string, unknown>) => void,
    nodeMap: NodeMap,
    parentId?: string,
  ): React.ReactNode {
    const p = node.props
    const pid = parentId ?? node.parent

    switch (node.type) {
      case 'paragraph':
        return <RichTextBlock text={(p.text as string) ?? ''} onChange={(text) => updateProps({ text })} tag="p" disabled={disabled} placeholder="Type '/' for commands..." yText={TEXT_BLOCK_TYPES.has(node.type) ? getBlockYText(nodeId, (p.text as string) ?? '') : null} awareness={TEXT_BLOCK_TYPES.has(node.type) ? awareness : null} fieldName={`block:${nodeId}`} onSlashCommand={(pos) => handleSlashCommand(nodeId, pid, pos)} onNewBlockAfter={() => handleNewBlockAfter(nodeId, pid)} onDeleteBlock={() => handleDeleteBlock(nodeId, pid)} slashMenuActive={slashState?.blockId === nodeId} onSlashNavigate={handleSlashNavigate} onSlashSelect={handleSlashSelectCurrent} onSlashClose={handleSlashClose} onSlashQueryChange={handleSlashQueryChange} />
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
              <RichTextBlock text={(p.text as string) ?? ''} onChange={(text) => updateProps({ text })} tag={`h${p.level ?? 2}` as 'h1' | 'h2' | 'h3'} disabled={disabled} yText={getBlockYText(nodeId, (p.text as string) ?? '')} awareness={awareness} fieldName={`block:${nodeId}`} />
            </div>
          </div>
        )
      case 'quote':
        return (
          <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic">
            <RichTextBlock text={(p.text as string) ?? ''} onChange={(text) => updateProps({ text })} tag="p" disabled={disabled} yText={getBlockYText(nodeId, (p.text as string) ?? '')} awareness={awareness} fieldName={`block:${nodeId}`} />
          </blockquote>
        )
      case 'image':
        return <ImageBlock src={(p.src as string) ?? ''} alt={(p.alt as string) ?? ''} caption={(p.caption as string) ?? ''} onChange={updateProps} uploadBase={uploadBase} disabled={disabled} />
      case 'code':
        return <CodeBlock code={(p.code as string) ?? ''} language={(p.language as string) ?? ''} onChange={updateProps} disabled={disabled} />
      case 'divider':
        return <DividerBlock />
      case 'list':
        return (
          <ListBlock
            node={node}
            nodeId={nodeId}
            nodeMap={nodeMap}
            onChange={onChange}
            renderBlock={(n, id, up, map) => renderBlockNode(n, id, up, map, nodeId)}
            defs={defs}
            defaultBlockProps={defaultBlockProps}
            disabled={disabled}
            onSlashCommand={handleSlashCommand}
            slashBlockId={slashState?.blockId ?? null}
            slashNavigate={handleSlashNavigate}
            slashSelect={handleSlashSelectCurrent}
            slashClose={handleSlashClose}
            slashQueryChange={handleSlashQueryChange}
          />
        )
      case 'table':
        return (
          <TableBlock
            node={node}
            nodeId={nodeId}
            nodeMap={nodeMap}
            onChange={onChange}
            renderBlock={(n, id, up, map) => renderBlockNode(n, id, up, map)}
            defs={defs}
            defaultBlockProps={defaultBlockProps}
            disabled={disabled}
          />
        )
      default:
        return <div className="text-xs text-muted-foreground py-2">Unknown block: {node.type}</div>
    }
  }

  return (
      <div ref={containerRef} onMouseDown={handleCrossBlockMouseDown} className="relative flex flex-col gap-1 min-h-[200px] rounded-lg border border-input bg-background p-3 pl-12">
        <InlineToolbar containerRef={containerRef} />

        {nodeIds.length === 0 && !disabled && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <BlockPicker defs={defs} onSelect={(type) => handleAddBlock(type)} trigger="empty" placeholder={placeholder} />
          </div>
        )}

        <SortableBlockList
          nodeIds={nodeIds}
          disabled={disabled}
          onReorder={handleReorder}
          renderNode={(id, index) => {
            const node = value[id]
            if (!node) return null

            const highlight = getBlockHighlight(id)

            return (
              <div className="group/content-block relative" data-block-id={id}>
                {/* Cross-block selection highlight overlay */}
                {highlight.type !== 'none' && (
                  <div className="absolute inset-0 bg-primary/15 pointer-events-none rounded" />
                )}

                {!disabled && (
                  <div className="absolute right-1 top-0 opacity-0 group-hover/content-block:opacity-100 transition-opacity z-10">
                    <button type="button" onClick={() => handleRemoveNode(id)}
                      className="text-xs text-destructive hover:text-destructive/80 p-0.5">&times;</button>
                  </div>
                )}

                {renderBlockNode(node, id, (patch) => handleUpdateNode(id, patch), value, 'ROOT')}

                {!disabled && !atMax && (
                  <div className="h-0 relative">
                    <div className="absolute inset-x-0 -top-0.5 flex justify-center opacity-0 group-hover/content-block:opacity-100 transition-opacity z-10 pointer-events-none">
                      <div className="pointer-events-auto">
                        <BlockPicker defs={defs} onSelect={(type) => handleAddBlock(type, index + 1)} trigger="between" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          }}
        />

        {nodeIds.length > 0 && !disabled && !atMax && (
          <div className="flex justify-center pt-2">
            <BlockPicker defs={defs} onSelect={(type) => handleAddBlock(type)} trigger="bottom" />
          </div>
        )}

        {/* Slash command menu */}
        {slashState && (
          <SlashCommandMenu
            defs={slashDefs()}
            query={slashState.query}
            selectedIndex={slashState.selectedIndex}
            onSelect={handleSlashSelectType}
            position={slashState.position}
          />
        )}
      </div>
  )
}
