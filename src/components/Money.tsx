import { formatINR, type Paise } from '../lib/money'

export const toneClass = (net: Paise) =>
  net > 0 ? 'text-owed dark:text-owed-dark' : net < 0 ? 'text-owe dark:text-owe-dark' : 'text-slate-500 dark:text-slate-400'

/** "owes you ₹200" / "you owe ₹200" / "settled up" from my point of view. Positive = they owe me. */
export function BalanceLine({ net, they = 'owes you', you = 'you owe' }: { net: Paise; they?: string; you?: string }) {
  if (net === 0) return <span className="text-sm text-slate-500 dark:text-slate-400">settled up</span>
  return (
    <span className={`text-right ${toneClass(net)}`}>
      <span className="block text-xs leading-tight">{net > 0 ? they : you}</span>
      <span className="block font-semibold tabular-nums">{formatINR(Math.abs(net))}</span>
    </span>
  )
}
