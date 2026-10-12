import type { Paise } from './money'

/** "debtor's debt to creditor goes down by amount" — what a payment clears. */
export interface Allocation {
  debtor: string
  creditor: string
  amount: Paise
}

export interface PaymentPlan {
  from: string
  to: string
  amount: Paise
  allocations: Allocation[]
}

/**
 * Plans a payment between one person (`single`) and a household, settling
 * with every member at once through one member (`actor`) who actually hands
 * over or receives the money.
 *
 * `balances[m]` is single's net with member m: positive = m owes single.
 *
 * - Settling the full combined amount clears every member's balance with
 *   `single`; the actor then owes / is owed the other members internally
 *   (e.g. Amit paid Neha's share, so Neha now owes Amit).
 * - A smaller amount clears the actor's own balance first, then the others
 *   in order of size. Balances running the other way are left alone.
 * - Anything above the combined amount is booked on the actor.
 */
export function planHouseholdPayment(args: {
  single: string
  actor: string
  members: string[]
  balances: Record<string, Paise>
  amount: Paise
  /** who hands over money: the single person, or the household (via actor) */
  payer: 'single' | 'household'
}): PaymentPlan {
  const { single, actor, members, balances, amount, payer } = args
  if (!members.includes(actor)) throw new Error('actor must be a household member')
  if (members.includes(single)) throw new Error('single must not be a household member')
  if (!(amount > 0)) throw new Error('amount must be positive')

  // owed[m] > 0: m's side owes money in the direction this payment flows.
  const sign = payer === 'single' ? -1 : 1
  const owed = Object.fromEntries(members.map((m) => [m, sign * (balances[m] ?? 0)]))
  const total = members.reduce((s, m) => s + owed[m], 0)

  const cleared: Record<string, Paise> = Object.fromEntries(members.map((m) => [m, 0]))
  if (amount >= total) {
    for (const m of members) cleared[m] = owed[m]
    cleared[actor] += amount - total
  } else {
    let left = amount
    const order = [actor, ...members.filter((m) => m !== actor).sort((a, b) => owed[b] - owed[a])]
    for (const m of order) {
      if (left === 0) break
      if (owed[m] <= 0) continue
      const take = Math.min(left, owed[m])
      cleared[m] = take
      left -= take
    }
    cleared[actor] += left
  }

  const allocations: Allocation[] = []
  const push = (debtor: string, creditor: string, value: Paise) => {
    if (value > 0) allocations.push({ debtor, creditor, amount: value })
    else if (value < 0) allocations.push({ debtor: creditor, creditor: debtor, amount: -value })
  }
  for (const m of members) {
    const c = cleared[m]
    if (c === 0) continue
    if (payer === 'single') {
      push(single, m, c) // single's debt to m goes down
      if (m !== actor) push(m, actor, c) // actor received m's money, so now owes m
    } else {
      push(m, single, c) // m's debt to single goes down
      if (m !== actor) push(actor, m, c) // actor paid for m, so m now owes actor
    }
  }

  return payer === 'single'
    ? { from: single, to: actor, amount, allocations }
    : { from: actor, to: single, amount, allocations }
}

/** Each person's net change from a set of allocations (debtor +, creditor −). */
export function allocationEffect(allocations: Allocation[]): Record<string, Paise> {
  const effect: Record<string, Paise> = {}
  for (const a of allocations) {
    effect[a.debtor] = (effect[a.debtor] ?? 0) + a.amount
    effect[a.creditor] = (effect[a.creditor] ?? 0) - a.amount
  }
  return effect
}

export interface TurnSuggestion {
  personId: string
  /** how far behind this person is (paise, positive) */
  behindBy: Paise
}

/**
 * Who should pay next so the books drift back to even: the person who is
 * furthest behind (most negative net). `nets`: positive = is owed.
 */
export function whoPaysNext(nets: Record<string, Paise>): TurnSuggestion | null {
  let best: TurnSuggestion | null = null
  for (const [personId, net] of Object.entries(nets)) {
    if (net < 0 && (!best || -net > best.behindBy)) best = { personId, behindBy: -net }
  }
  return best
}
