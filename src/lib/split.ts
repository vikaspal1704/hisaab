import type { Paise } from './money'

/**
 * A row in a split: a single person, or a household counted as one unit.
 * Whatever the unit owes is booked on `repId` (the member who paid, if any,
 * otherwise the first member), so a couple splitting "as one" never ends up
 * owing each other for the same bill.
 */
export interface SplitUnit {
  key: string
  repId: string
  memberIds: string[]
}

/**
 * Splits `amount` proportionally to `weights` using the largest-remainder
 * method, so the parts always add up to exactly `amount`. Ties for the extra
 * paise go to earlier rows, which keeps results stable.
 */
export function splitByWeights(amount: Paise, weights: number[]): Paise[] {
  const total = weights.reduce((s, w) => s + w, 0)
  if (amount < 0 || !Number.isInteger(amount)) throw new Error('amount must be whole paise')
  if (weights.some((w) => !(w >= 0) || !Number.isFinite(w)) || total <= 0) {
    throw new Error('weights must be non-negative with a positive total')
  }
  // Whole-number weights (the usual case) compare exact integer remainders, so
  // floating-point noise never decides who gets the extra paisa.
  const integral = weights.every(Number.isInteger) && Number.isSafeInteger(amount * total)
  const frac = weights.map((w) => (integral ? (amount * w) % total : (amount * w) / total - Math.floor((amount * w) / total)))
  const parts = weights.map((w, i) => (integral ? (amount * w - frac[i]) / total : Math.floor((amount * w) / total)))
  let remaining = amount - parts.reduce((s, p) => s + p, 0)
  const order = frac
    .map((value, index) => ({ index, frac: value }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index)
  for (const { index } of order) {
    if (remaining === 0) break
    parts[index] += 1
    remaining -= 1
  }
  return parts
}

export interface EntryPart {
  person_id: string
  paid: Paise
  owed: Paise
  shares: number | null
}

/** How an expense was split. "items" is booked as exact amounts worked out from the bill (see itemSplit). */
export type SplitMode = 'equal' | 'exact' | 'shares' | 'items'

export interface SplitInput {
  amount: Paise
  mode: Exclude<SplitMode, 'items'>
  units: SplitUnit[]
  /** shares per unit key (mode "shares"); exact paise per unit key (mode "exact") */
  values: Record<string, number>
  /** who paid how much */
  payers: Record<string, Paise>
}

export type SplitResult =
  | { ok: true; parts: EntryPart[]; owedByUnit: Record<string, Paise> }
  | { ok: false; error: string }

/** Builds the parts for an expense, or explains what is wrong with the input. */
export function buildSplit(input: SplitInput): SplitResult {
  const { amount, mode, units, values, payers } = input
  if (!(amount > 0)) return { ok: false, error: 'Enter an amount' }
  if (units.length === 0) return { ok: false, error: 'Pick who this is split with' }

  const paidTotal = Object.values(payers).reduce((s, p) => s + p, 0)
  if (paidTotal !== amount) return { ok: false, error: 'Amounts paid must add up to the total' }

  let owed: Paise[]
  if (mode === 'exact') {
    owed = units.map((u) => Math.round(values[u.key] ?? 0))
    if (owed.some((o) => o < 0)) return { ok: false, error: 'Amounts cannot be negative' }
    const sum = owed.reduce((s, o) => s + o, 0)
    if (sum !== amount) return { ok: false, error: 'Split amounts must add up to the total' }
  } else {
    const weights = units.map((u) => (mode === 'equal' ? u.memberIds.length : (values[u.key] ?? 0)))
    if (weights.reduce((s, w) => s + w, 0) <= 0) return { ok: false, error: 'Give at least one share' }
    owed = splitByWeights(amount, weights)
  }

  const owedByUnit: Record<string, Paise> = {}
  const byPerson = new Map<string, EntryPart>()
  const part = (id: string) => {
    let p = byPerson.get(id)
    if (!p) byPerson.set(id, (p = { person_id: id, paid: 0, owed: 0, shares: null }))
    return p
  }

  units.forEach((unit, i) => {
    owedByUnit[unit.key] = owed[i]
    const payerInUnit = unit.memberIds.find((m) => (payers[m] ?? 0) > 0)
    const target = part(payerInUnit ?? unit.repId)
    target.owed += owed[i]
    if (mode === 'shares') target.shares = (target.shares ?? 0) + (values[unit.key] ?? 0) || null
  })
  for (const [id, paid] of Object.entries(payers)) if (paid > 0) part(id).paid += paid

  const parts = [...byPerson.values()]
  if (parts.every((p) => p.paid === p.owed)) {
    return { ok: false, error: 'Nobody owes anybody — add someone else' }
  }
  return { ok: true, parts, owedByUnit }
}
