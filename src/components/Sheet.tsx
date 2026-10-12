import { useEffect, useRef, type ReactNode } from 'react'

/** Bottom sheet built on <dialog> so focus trapping and Esc come for free. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-none bg-transparent p-0 backdrop:bg-slate-950/50 sm:mx-auto sm:max-w-lg"
    >
      {open ? (
        <div className="animate-sheet-in pb-safe flex max-h-[90dvh] flex-col rounded-t-3xl bg-white dark:bg-slate-900">
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
          <h2 className="px-5 pt-3 pb-2 text-lg font-semibold">{title}</h2>
          <div className="overflow-y-auto px-5 pb-4">{children}</div>
        </div>
      ) : null}
    </dialog>
  )
}
