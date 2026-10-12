import { balanceLabel, type Style } from '../lib/baari'
import { useT } from '../lib/i18n'
import { formatINR, type Paise } from '../lib/money'

export const toneClass = (net: Paise) =>
  net > 0 ? 'text-owed dark:text-owed-dark' : net < 0 ? 'text-owe dark:text-owe-dark' : 'text-slate-500 dark:text-slate-400'

/** "owes you ₹200" / "you owe ₹200" / "settled up" from my point of view. Positive = they owe me. */
export function BalanceLine({ net, they = 'owes you', you = 'you owe' }: { net: Paise; they?: string; you?: string }) {
  const { t } = useT()
  if (net === 0) return <span className="text-sm text-slate-500 dark:text-slate-400">{t('settled up')}</span>
  return (
    <span className={`text-right ${toneClass(net)}`}>
      <span className="block text-xs leading-tight">{t(net > 0 ? they : you)}</span>
      <span className="block font-semibold tabular-nums">{formatINR(Math.abs(net))}</span>
    </span>
  )
}

/** A balance in the friend's chosen style: "their baari ₹500", "barabar 👍", "you owe ₹200". */
export function StyledBalance({ net, style, tolerance, plural = false }: { net: Paise; style: Style; tolerance: Paise; plural?: boolean }) {
  const { t } = useT()
  const label = balanceLabel(net, style, tolerance)
  const top = plural && label.top === 'owes you' ? 'owe you' : label.top
  if (label.tone === 'even') {
    return (
      <span className="text-right text-sm text-slate-500 dark:text-slate-400">
        <span className="block">{t(top)}</span>
        {net !== 0 ? <span className="block text-xs tabular-nums">{formatINR(Math.abs(net))}</span> : null}
      </span>
    )
  }
  return (
    <span className={`text-right ${toneClass(net)}`}>
      <span className="block text-xs leading-tight">{t(top)}</span>
      <span className="block font-semibold tabular-nums">{formatINR(Math.abs(net))}</span>
    </span>
  )
}
