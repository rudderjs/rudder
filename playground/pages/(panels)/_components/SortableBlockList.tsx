import { useState, useEffect } from 'react'
import { DndContext, closestCenter, DragOverlay, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

interface Props {
  /** Ordered node IDs. */
  nodeIds:    string[]
  /** Render function for each node. Receives the node ID and index. */
  renderNode: (id: string, index: number) => React.ReactNode
  /** Called when items are reordered via drag. Receives (fromIndex, toIndex). */
  onReorder?: (fromIndex: number, toIndex: number) => void
  disabled?:  boolean
}

/**
 * Self-contained sortable list with its own DndContext.
 * Drag is scoped to this container only — no cross-container moves.
 * DndContext is client-only to avoid SSR hydration mismatches (aria-describedby IDs differ).
 */
export function SortableBlockList({ nodeIds, renderNode, onReorder, disabled }: Props) {
  const [mounted, setMounted] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  useEffect(() => { setMounted(true) }, [])

  if (disabled || !onReorder || !mounted) {
    return (
      <>
        {nodeIds.map((id, index) => (
          <div key={id}>{renderNode(id, index)}</div>
        ))}
      </>
    )
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = nodeIds.indexOf(active.id as string)
    const toIndex = nodeIds.indexOf(over.id as string)
    if (fromIndex === -1 || toIndex === -1) return
    onReorder(fromIndex, toIndex)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(e) => setActiveDragId(e.active.id as string)} onDragEnd={handleDragEnd} onDragCancel={() => setActiveDragId(null)}>
      <SortableContext items={nodeIds} strategy={verticalListSortingStrategy}>
        {nodeIds.map((id, index) => (
          <SortableItem key={id} id={id}>
            {renderNode(id, index)}
          </SortableItem>
        ))}
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeDragId ? (
          <div className="opacity-80 shadow-lg rounded bg-background border border-border px-3 py-2 text-sm text-muted-foreground">
            Moving block…
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

export function SortableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-30' : ''}
      {...attributes}
    >
      <div className="group/sortable relative">
        {/* Drag handle */}
        <div
          {...listeners}
          className="absolute -left-8 top-2 cursor-grab active:cursor-grabbing opacity-0 group-hover/sortable:opacity-100 transition-opacity"
        >
          <GripVertical className="size-4 text-muted-foreground" />
        </div>
        {children}
      </div>
    </div>
  )
}
