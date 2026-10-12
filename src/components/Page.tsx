import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconBack } from './icons'

/** Screen scaffold: sticky top bar with optional back button and actions. */
export function Page({
  title,
  back,
  actions,
  children,
  footer,
  withNav = false,
}: {
  title: ReactNode
  back?: boolean | string
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  withNav?: boolean
}) {
  const navigate = useNavigate()
  const goBack = () => {
    if (typeof back === 'string') navigate(back)
    else if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/')
  }
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="pt-safe sticky top-0 z-20 bg-slate-50/90 backdrop-blur dark:bg-slate-950/90">
        <div className="flex h-14 items-center gap-1 px-2">
          {back ? (
            <button type="button" onClick={goBack} aria-label="Back" className="flex h-11 w-11 items-center justify-center rounded-full active:bg-slate-200 dark:active:bg-slate-800">
              <IconBack />
            </button>
          ) : (
            <span className="w-2" />
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
          {actions}
        </div>
      </header>
      <main className={`flex-1 px-4 ${withNav ? 'pb-28' : footer ? 'pb-32' : 'pb-8'}`}>{children}</main>
      {footer ? (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-slate-50/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className="mx-auto max-w-lg px-4 pt-3">{footer}</div>
        </div>
      ) : null}
    </div>
  )
}

export function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex h-11 w-11 items-center justify-center rounded-full text-slate-700 active:bg-slate-200 dark:text-slate-200 dark:active:bg-slate-800">
      {children}
    </button>
  )
}
