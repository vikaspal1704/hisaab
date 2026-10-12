import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { IconBack } from './icons'

/**
 * Screen scaffold. On phones: sticky top bar and a footer pinned to the
 * bottom. On laptops (lg+): a page header in the content column next to the
 * sidebar, and the footer as a floating action bar at the end of the column.
 * `wide` pages use multi-column layouts on laptops.
 */
export function Page({
  title,
  back,
  actions,
  children,
  footer,
  withNav = false,
  wide = false,
}: {
  title: ReactNode
  back?: boolean | string
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  withNav?: boolean
  wide?: boolean
}) {
  const navigate = useNavigate()
  const { t } = useT()
  const goBack = () => {
    if (typeof back === 'string') navigate(back)
    else if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/')
  }
  return (
    <div className={`mx-auto flex min-h-dvh max-w-lg flex-col lg:min-h-0 lg:px-10 lg:pt-8 lg:pb-16 ${wide ? 'lg:max-w-6xl' : 'lg:max-w-3xl'}`}>
      <header className="pt-safe sticky top-0 z-20 bg-canvas/90 backdrop-blur dark:bg-canvas-dark/90 lg:static lg:bg-transparent lg:pt-0 lg:backdrop-blur-none dark:lg:bg-transparent">
        <div className="flex h-14 items-center gap-1 px-2 lg:h-auto lg:min-h-12 lg:gap-3 lg:px-0 lg:pb-6">
          {back ? (
            <button
              type="button"
              onClick={goBack}
              aria-label={t('Back')}
              className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-slate-200/70 active:bg-slate-200 lg:h-10 lg:w-10 lg:bg-white lg:shadow-card lg:ring-1 lg:ring-slate-200/70 dark:hover:bg-slate-800 dark:active:bg-slate-800 dark:lg:bg-slate-900 dark:lg:ring-slate-800"
            >
              <IconBack />
            </button>
          ) : (
            <span className="w-2 lg:hidden" />
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold lg:text-[28px] lg:leading-tight lg:font-bold lg:tracking-tight">{title}</h1>
          {actions ? <div className="flex items-center gap-1 lg:gap-2">{actions}</div> : null}
        </div>
      </header>
      <main className={`flex-1 px-4 lg:px-0 ${withNav ? 'pb-28 lg:pb-0' : footer ? 'pb-32 lg:pb-0' : 'pb-8 lg:pb-0'}`}>{children}</main>
      {footer ? (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-canvas/95 backdrop-blur dark:border-slate-800 dark:bg-canvas-dark/95 lg:sticky lg:bottom-6 lg:mt-8 lg:rounded-2xl lg:border lg:border-slate-200/80 lg:bg-white/95 lg:pb-3 lg:shadow-raised dark:lg:border-slate-800 dark:lg:bg-slate-900/95">
          <div className="mx-auto max-w-lg px-4 pt-3 lg:max-w-none">{footer}</div>
        </div>
      ) : null}
    </div>
  )
}

export function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-slate-200/70 active:bg-slate-200 lg:h-10 lg:w-10 lg:bg-white lg:shadow-card lg:ring-1 lg:ring-slate-200/70 lg:hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-800 dark:lg:bg-slate-900 dark:lg:ring-slate-800"
    >
      {children}
    </button>
  )
}
