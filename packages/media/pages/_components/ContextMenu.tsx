'use client'

interface Props {
  x: number
  y: number
  onClose: () => void
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}

export function ContextMenu({ x, y, onClose, onOpen, onRename, onDelete }: Props) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 rounded-lg border bg-popover py-1 shadow-lg text-sm min-w-[160px]"
        style={{ left: x, top: y }}
      >
        <button
          className="w-full px-3 py-1.5 text-left hover:bg-muted transition-colors"
          onClick={onOpen}
        >
          Open
        </button>
        <button
          className="w-full px-3 py-1.5 text-left hover:bg-muted transition-colors"
          onClick={onRename}
        >
          Rename
        </button>
        <div className="my-1 border-t" />
        <button
          className="w-full px-3 py-1.5 text-left text-destructive hover:bg-muted transition-colors"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </>
  )
}
