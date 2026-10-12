import type { Paise } from './money'

export type Style = 'baari' | 'exact'

export type RelationState =
  | { kind: 'even'; amount: Paise } // within tolerance: "barabar"
  | { kind: 'they_owe'; amount: Paise } // positive balance beyond tolerance
  | { kind: 'i_owe'; amount: Paise }

/**
 * How to talk about a balance. `net` is positive when they owe me.
 * Anything within the tolerance counts as even — friends don't chase ₹37.
 */
export function relationState(net: Paise, tolerance: Paise): RelationState {
  if (Math.abs(net) <= tolerance) return { kind: 'even', amount: Math.abs(net) }
  return net > 0 ? { kind: 'they_owe', amount: net } : { kind: 'i_owe', amount: -net }
}

/** Short label for a balance in the chosen style, from my point of view. */
export function balanceLabel(net: Paise, style: Style, tolerance: Paise): { top: string; tone: 'owed' | 'owe' | 'even' } {
  const state = relationState(net, style === 'baari' ? tolerance : 0)
  if (state.kind === 'even') return { top: net === 0 ? 'settled up' : 'barabar 👍', tone: 'even' }
  if (style === 'baari') {
    return state.kind === 'they_owe' ? { top: 'their baari', tone: 'owed' } : { top: 'your baari', tone: 'owe' }
  }
  return state.kind === 'they_owe' ? { top: 'owes you', tone: 'owed' } : { top: 'you owe', tone: 'owe' }
}
