import { useState } from 'react'
import { DndContext, closestCenter, DragOverlay, type DragStartEvent, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { icons } from 'lucide-react'

const GripVertical = icons['GripVertical']!

interface Props {
  /** Ordered node IDs. */
  nodeIds:    string[]
  /** Called when a drag completes with (activeId, oldIndex, newIndex). */
  onReorder:  (id: string, fromIndex: number, toIndex: number) => void
  /** Render function for each node. Receives the node ID and index. */
  renderNode: (id: string, index: number) => React.ReactNode
  disabled?:  boolean
}

export function SortableBlockList({ nodeIds, onReorder, renderNode, disabled }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
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

  const activeIndex = activeId ? nodeIds.indexOf(activeId) : -1

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <SortableContext items={nodeIds} strategy={verticalListSortingStrategy}>
        {nodeIds.map((id, index) => (
          <SortableItem key={id} id={id} isDragOverlay={false}>
            {renderNode(id, index)}
          </SortableItem>
        ))}
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeId && activeIndex !== -1 ? (
          <div className="opacity-90 shadow-lg rounded bg-background border border-border">
            <div className="group/sortable relative">
              <div className="absolute -left-8 top-2 cursor-grabbing">
                <GripVertical className="size-4 text-muted-foreground" />
              </div>
              {renderNode(activeId, activeIndex)}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function SortableItem({ id, children, isDragOverlay }: { id: string; children: React.ReactNode; isDragOverlay: boolean }) {
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
