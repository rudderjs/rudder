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
        <Dialog.Popup className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-xl bg-white shadow-xl p-6 outline-none">
          <Dialog.Title className="text-base font-semibold text-slate-900 mb-1">
            {title}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-slate-500 mb-6">
            {message}
          </Dialog.Description>
          <div className="flex justify-end gap-3">
            <Dialog.Close
              className="px-4 py-2 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </Dialog.Close>
            <button
              onClick={onConfirm}
              className={[
                'px-4 py-2 text-sm rounded-md text-white font-medium transition-colors',
                danger
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-indigo-600 hover:bg-indigo-700',
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
