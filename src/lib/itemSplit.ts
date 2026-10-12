import type { Paise } from './money'
import { splitByWeights, type SplitUnit } from './split'

/** One line on the bill, shared equally by the units who had it. */
export interface BillLine {
  key: string
  name: string
  amount: Paise
  unitKeys: string[]
}

/** Charges on top of the items (shared in proportion to what each person had). */
export interface BillExtras {
  tax: Paise
  tip: Paise
  discount: Paise
}

/** What the database stores: people instead of form units. */
export interface StoredItems {
  lines: { name: string; amount: Paise; people: string[] }[]
  tax: Paise
  tip: Paise
  discount: Paise
}

export type ItemSplitResult =
  | { ok: true; total: Paise; subtotal: Paise; owedByUnit: Record<string, Paise> }
  | { ok: false; error: string }

export const NO_EXTRAS: BillExtras = { tax: 0, tip: 0, discount: 0 }

/**
 * Works out what each unit owes for an itemised bill: every item split equally
 * between the units who had it (a pair counts as its members), then tax, tip
 * and discount spread in proportion to each unit's items. Always adds up to
 * the bill exactly.
 */
export function splitItems(units: SplitUnit[], lines: BillLine[], extras: BillExtras): ItemSplitResult {
  const live = lines.filter((l) => l.amount > 0 || l.name.trim())
  if (live.length === 0) return { ok: false, error: 'Add the items on the bill' }
  if (live.some((l) => !(l.amount > 0) || !Number.isInteger(l.amount))) return { ok: false, error: 'Give every item a price' }
  if ([extras.tax, extras.tip, extras.discount].some((x) => !(x >= 0) || !Number.isInteger(x))) {
    return { ok: false, error: 'Check the tax, tip and discount' }
  }

  const index = new Map(units.map((u, i) => [u.key, i]))
  const subtotals = units.map(() => 0)
  for (const line of live) {
    const sharers = [...new Set(line.unitKeys)].filter((k) => index.has(k))
    if (sharers.length === 0) return { ok: false, error: 'Pick who had each item' }
    const parts = splitByWeights(line.amount, sharers.map((k) => units[index.get(k)!].memberIds.length))
    sharers.forEach((k, i) => (subtotals[index.get(k)!] += parts[i]))
  }

  const subtotal = subtotals.reduce((s, x) => s + x, 0)
  const total = subtotal + extras.tax + extras.tip - extras.discount
  if (total <= 0) return { ok: false, error: 'The discount is more than the bill' }

  const charges = extras.tax + extras.tip - extras.discount
  const spread = charges === 0 ? units.map(() => 0) : splitByWeights(Math.abs(charges), subtotals)
  const owed = subtotals.map((s, i) => s + Math.sign(charges) * spread[i])
  return { ok: true, total, subtotal, owedByUnit: Object.fromEntries(units.map((u, i) => [u.key, owed[i]])) }
}

/** For saving: units become the people in them. */
export function toStoredItems(units: SplitUnit[], lines: BillLine[], extras: BillExtras): StoredItems {
  const members = new Map(units.map((u) => [u.key, u.memberIds]))
  return {
    lines: lines
      .filter((l) => l.amount > 0)
      .map((l, i) => ({
        name: l.name.trim() || `Item ${i + 1}`,
        amount: l.amount,
        people: [...new Set(l.unitKeys.flatMap((k) => members.get(k) ?? []))],
      })),
    ...extras,
  }
}

/** For editing: each person on an item becomes their own unit. */
export function fromStoredItems(items: StoredItems): { lines: BillLine[]; extras: BillExtras; personIds: string[] } {
  const lines = items.lines.map((l, i) => ({ key: `l${i}`, name: l.name, amount: Number(l.amount), unitKeys: [...l.people] }))
  return {
    lines,
    extras: { tax: Number(items.tax ?? 0), tip: Number(items.tip ?? 0), discount: Number(items.discount ?? 0) },
    personIds: [...new Set(items.lines.flatMap((l) => l.people))],
  }
}

/** A percentage of the item total, to the paisa. */
export function percentOf(subtotal: Paise, percent: number): Paise {
  return Math.round((subtotal * percent) / 100)
}
