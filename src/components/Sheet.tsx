import { useEffect, useRef, type ReactNode } from 'react'
import { useT } from '../lib/i18n'
import { IconX } from './icons'

/**
 * Bottom sheet on phones, centred dialog on laptops. Built on <dialog> so
 * focus trapping and Esc come for free.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { t } = useT()
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
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-none bg-transparent p-0 text-slate-900 backdrop:bg-slate-950/50 backdrop:backdrop-blur-[2px] sm:mx-auto sm:max-w-lg lg:m-auto lg:max-h-[85dvh] lg:max-w-md dark:text-slate-100"
    >
      {open ? (
        <div className="animate-sheet-in lg:animate-pop-in pb-safe flex max-h-[90dvh] flex-col rounded-t-3xl bg-white shadow-raised lg:max-h-[85dvh] lg:rounded-3xl lg:pb-2 dark:bg-slate-900">
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-300 lg:hidden dark:bg-slate-700" />
          <div className="flex items-center gap-2 px-5 pt-3 pb-2 lg:pt-5">
            <h2 className="flex-1 text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('Close')}
              className="hidden h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 lg:flex dark:hover:bg-slate-800"
            >
              <IconX size={18} />
            </button>
          </div>
          <div className="overflow-y-auto px-5 pb-4">{children}</div>
        </div>
      ) : null}
    </dialog>
  )
}
