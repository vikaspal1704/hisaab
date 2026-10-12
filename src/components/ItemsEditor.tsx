import { IconPlus, IconX } from './icons'
import { Card } from './ui'
import { useT } from '../lib/i18n'
import { percentOf, type ItemSplitResult } from '../lib/itemSplit'
import { formatINR, parseRupees, toRupeeInput, type Paise } from '../lib/money'
import type { SplitUnit } from '../lib/split'

/** A bill line as typed: the price stays text until it's valid. */
export interface ItemDraft {
  key: string
  name: string
  amountText: string
  unitKeys: string[]
}

export interface ExtrasDraft {
  tax: string
  tip: string
  discount: string
}

let nextKey = 0
export const newItem = (unitKeys: string[]): ItemDraft => ({ key: `n${nextKey++}`, name: '', amountText: '', unitKeys })

const smallInput =
  'h-11 rounded-xl bg-slate-100 px-3 tabular-nums outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 dark:bg-slate-800'

/**
 * Type the bill line by line and tap who had what. Tax, tip and discount are
 * shared in proportion; the receipt total is an optional check.
 */
export function ItemsEditor({
  units,
  unitLabel,
  items,
  onItems,
  extras,
  onExtras,
  receiptText,
  onReceiptText,
  result,
  subtotal,
}: {
  units: SplitUnit[]
  unitLabel: (u: SplitUnit) => string
  items: ItemDraft[]
  onItems: (items: ItemDraft[]) => void
  extras: ExtrasDraft
  onExtras: (extras: ExtrasDraft) => void
  receiptText: string
  onReceiptText: (text: string) => void
  result: ItemSplitResult | null
  /** sum of valid item prices, for the % buttons */
  subtotal: Paise
}) {
  const { t } = useT()
  const allKeys = units.map((u) => u.key)
  const update = (key: string, patch: Partial<ItemDraft>) => onItems(items.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  const toggle = (item: ItemDraft, unitKey: string) =>
    update(item.key, {
      unitKeys: item.unitKeys.includes(unitKey) ? item.unitKeys.filter((k) => k !== unitKey) : [...item.unitKeys, unitKey],
    })

  const total = result?.ok ? result.total : null
  const receipt = parseRupees(receiptText)
  const gap = total !== null && receipt !== null ? receipt - total : 0
  const chip = (active: boolean) =>
    `min-h-8 rounded-full px-3 text-sm font-medium ring-1 ${
      active ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700'
    }`

  return (
    <div className="mt-3 space-y-3">
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((item, index) => {
          const everyone = allKeys.length > 0 && allKeys.every((k) => item.unitKeys.includes(k))
          return (
            <div key={item.key} className="space-y-2 p-3">
              <div className="flex items-center gap-2">
                <input
                  aria-label={t('Item {n}', { n: index + 1 })}
                  placeholder={t('Item (e.g. Paneer tikka)')}
                  value={item.name}
                  maxLength={60}
                  onChange={(e) => update(item.key, { name: e.target.value })}
                  className={`${smallInput} min-w-0 flex-1`}
                />
                <input
                  aria-label={t('Price of item {n}', { n: index + 1 })}
                  inputMode="decimal"
                  placeholder="₹0"
                  value={item.amountText}
                  onChange={(e) => update(item.key, { amountText: e.target.value.replace(/[^\d.,]/g, '') })}
                  className={`${smallInput} w-24 text-right`}
                />
                <button
                  type="button"
                  aria-label={t('Remove item {n}', { n: index + 1 })}
                  onClick={() => onItems(items.filter((i) => i.key !== item.key))}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 active:bg-slate-100 dark:active:bg-slate-800"
                >
                  <IconX size={18} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Who had item {n}', { n: index + 1 })}>
                {units.length > 1 ? (
                  <button type="button" aria-pressed={everyone} className={chip(everyone)} onClick={() => update(item.key, { unitKeys: everyone ? [] : allKeys })}>
                    {t('Everyone')}
                  </button>
                ) : null}
                {units.map((u) => {
                  const on = item.unitKeys.includes(u.key)
                  return (
                    <button key={u.key} type="button" aria-pressed={on} className={chip(on)} onClick={() => toggle(item, u.key)}>
                      {unitLabel(u)}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => onItems([...items, newItem(allKeys)])}
          className="flex min-h-12 w-full items-center justify-center gap-1 text-sm font-semibold text-brand-700 dark:text-brand-500"
        >
          <IconPlus size={16} /> {t('Add item')}
        </button>
      </Card>

      <Card className="space-y-3 p-3">
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['tax', t('Tax & charges')],
              ['tip', t('Tip')],
              ['discount', t('Discount')],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block min-w-0">
              <span className="mb-1 block truncate text-xs font-medium text-slate-500">{label}</span>
              <input
                inputMode="decimal"
                placeholder="₹0"
                value={extras[key]}
                onChange={(e) => onExtras({ ...extras, [key]: e.target.value.replace(/[^\d.,]/g, '') })}
                className={`${smallInput} w-full text-right`}
              />
            </label>
          ))}
        </div>
        {subtotal > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-slate-500">{t('GST / service:')}</span>
            {[5, 10, 18].map((p) => (
              <button key={p} type="button" className={chip(false)} onClick={() => onExtras({ ...extras, tax: toRupeeInput(percentOf(subtotal, p)) })}>
                {p}%
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
          <span className="text-sm text-slate-500">{t('Bill total')}</span>
          <span className="text-lg font-bold tabular-nums">{total !== null ? formatINR(total) : '—'}</span>
        </div>
        <label className="flex items-center gap-2">
          <span className="flex-1 text-sm text-slate-500">{t('Total on the receipt (to check)')}</span>
          <input
            inputMode="decimal"
            placeholder={t('optional')}
            value={receiptText}
            onChange={(e) => onReceiptText(e.target.value.replace(/[^\d.,]/g, ''))}
            className={`${smallInput} w-28 text-right`}
          />
        </label>
        {total !== null && receipt !== null ? (
          gap === 0 ? (
            <p className="text-sm text-owed">✓ {t('Matches the receipt')}</p>
          ) : gap > 0 ? (
            <div className="flex items-center gap-2 text-sm text-owe">
              <span className="flex-1">{t('{amount} on the receipt isn’t in the items yet', { amount: formatINR(gap) })}</span>
              <button
                type="button"
                className="min-h-9 shrink-0 rounded-full bg-amber-100 px-3 font-semibold text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
                onClick={() => onExtras({ ...extras, tax: toRupeeInput((parseRupees(extras.tax) ?? 0) + gap) })}
              >
                {t('Add as charges')}
              </button>
            </div>
          ) : (
            <p className="text-sm text-owe">{t('Items come to {amount} more than the receipt', { amount: formatINR(-gap) })}</p>
          )
        ) : null}
      </Card>
    </div>
  )
}
