import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { IconChevron } from './icons'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white active:bg-brand-800 disabled:bg-slate-300 dark:disabled:bg-slate-700',
  secondary:
    'bg-white text-slate-900 ring-1 ring-slate-200 active:bg-slate-100 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 dark:active:bg-slate-800',
  ghost: 'text-brand-700 active:bg-brand-50 dark:text-brand-500 dark:active:bg-slate-800',
  danger: 'bg-white text-red-600 ring-1 ring-red-200 active:bg-red-50 dark:bg-slate-900 dark:ring-red-900',
}

export function Button({
  variant = 'primary',
  block,
  busy,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${VARIANTS[variant]} ${block ? 'w-full' : ''} ${className}`}
      disabled={disabled || busy}
      {...props}
    >
      {busy ? <Spinner /> : children}
    </button>
  )
}

export function ButtonLink({ to, variant = 'primary', block, className = '', children }: {
  to: string
  variant?: Variant
  block?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Link
      to={to}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-semibold ${VARIANTS[variant]} ${block ? 'w-full' : ''} ${className}`}
    >
      {children}
    </Link>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  const { t } = useT()
  return (
    <span
      role="status"
      aria-label={t('Loading')}
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800 ${className}`}>
      {children}
    </div>
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-sm text-red-600 dark:text-red-400">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{hint}</span>
      ) : null}
    </label>
  )
}

export const inputClass =
  'block w-full min-h-12 rounded-xl border-0 bg-white px-3.5 text-base ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 focus:outline-none dark:bg-slate-900 dark:ring-slate-700'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClass} {...props} />
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-lg text-sm font-medium transition-colors ${
            value === o.value
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A tappable list row with avatar slot, title, subtitle and trailing content. */
export function Row({
  to,
  onClick,
  leading,
  title,
  subtitle,
  trailing,
  chevron = true,
}: {
  to?: string
  onClick?: () => void
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  chevron?: boolean
}) {
  const content = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle ? <span className="block truncate text-sm text-slate-500 dark:text-slate-400">{subtitle}</span> : null}
      </span>
      {trailing}
      {chevron && (to || onClick) ? <IconChevron size={18} className="shrink-0 text-slate-400" /> : null}
    </>
  )
  const cls = 'flex w-full min-h-16 items-center gap-3 px-4 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-800/60'
  if (to) return <Link to={to} className={cls}>{content}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{content}</button>
  return <div className={cls}>{content}</div>
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">{children}</h2>
      {action}
    </div>
  )
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon ? <div className="mb-4 text-brand-600">{icon}</div> : null}
      <h2 className="text-lg font-semibold">{title}</h2>
      {body ? <p className="mt-1 max-w-xs text-slate-500 dark:text-slate-400">{body}</p> : null}
      {action ? <div className="mt-6 w-full max-w-xs">{action}</div> : null}
    </div>
  )
}

export function LoadingView() {
  return (
    <div className="flex justify-center py-16 text-brand-700">
      <Spinner />
    </div>
  )
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useT()
  return (
    <EmptyState
      title={t('Couldn’t load this')}
      body={message}
      action={onRetry ? <Button variant="secondary" block onClick={onRetry}>{t('Try again')}</Button> : undefined}
    />
  )
}
