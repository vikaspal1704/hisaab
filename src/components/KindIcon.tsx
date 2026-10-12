import { IconGift, IconHandshake, IconHeartHand, IconPiggy, IconReceipt, IconTrash } from './icons'

const STYLES: Record<string, { Icon: typeof IconReceipt; tone: string }> = {
  expense: { Icon: IconReceipt, tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  payment: { Icon: IconHandshake, tone: 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300' },
  forgive: { Icon: IconHeartHand, tone: 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300' },
  treat: { Icon: IconGift, tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  kitty: { Icon: IconPiggy, tone: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' },
  deleted: { Icon: IconTrash, tone: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300' },
}

/** The tile at the start of a ledger row: what kind of entry this is. */
export function KindIcon({ kind, className = '' }: { kind: string; className?: string }) {
  const { Icon, tone } = STYLES[kind] ?? STYLES.expense
  return (
    <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone} ${className}`}>
      <Icon size={19} />
    </span>
  )
}
