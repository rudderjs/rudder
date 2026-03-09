import { Dialog } from '@base-ui-components/react/dialog'

interface Props {
  open:      boolean
  onClose:   () => void
  onConfirm: () => void
  title:     string
  message:   string
  danger?:   boolean
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, danger }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Popup className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-xl bg-card shadow-xl p-6 outline-none border">
          <Dialog.Title className="text-base font-semibold mb-1">
            {title}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground mb-6">
            {message}
          </Dialog.Description>
          <div className="flex justify-end gap-3">
            <Dialog.Close className="px-4 py-2 text-sm rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
              Cancel
            </Dialog.Close>
            <button
              onClick={onConfirm}
              className={[
                'px-4 py-2 text-sm rounded-md font-medium transition-colors',
                danger
                  ? 'bg-destructive text-white hover:opacity-90'
                  : 'bg-primary text-primary-foreground hover:opacity-90',
              ].join(' ')}
            >
              Confirm
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
