import { describe, expect, it } from 'vitest'
import { allocationEffect, planHouseholdPayment, whoPaysNext } from '../../src/lib/settle'
import { upiPayLink } from '../../src/lib/upi'

/** The server's conservation rule: payer +amount, receiver −amount, everyone else 0. */
function expectBalanced(plan: ReturnType<typeof planHouseholdPayment>) {
  const effect = allocationEffect(plan.allocations)
  effect[plan.from] = (effect[plan.from] ?? 0) - plan.amount
  effect[plan.to] = (effect[plan.to] ?? 0) + plan.amount
  for (const v of Object.values(effect)) expect(v).toBe(0)
}

/** Applies a plan to single's balances with each member. */
function applyToBalances(single: string, balances: Record<string, number>, plan: ReturnType<typeof planHouseholdPayment>) {
  const next = { ...balances }
  for (const a of plan.allocations) {
    if (a.creditor === single) next[a.debtor] -= a.amount // they owe single less
    if (a.debtor === single) next[a.creditor] += a.amount // single owes them less
  }
  return next
}

describe('planHouseholdPayment', () => {
  it('lets Amit pay for himself and Neha', () => {
    // Amit owes me 500, Neha owes me 300.
    const balances = { amit: 500, neha: 300 }
    const plan = planHouseholdPayment({
      single: 'me',
      actor: 'amit',
      members: ['amit', 'neha'],
      balances,
      amount: 800,
      payer: 'household',
    })
    expect(plan).toEqual({
      from: 'amit',
      to: 'me',
      amount: 800,
      allocations: [
        { debtor: 'amit', creditor: 'me', amount: 500 },
        { debtor: 'neha', creditor: 'me', amount: 300 },
        { debtor: 'amit', creditor: 'neha', amount: 300 },
      ],
    })
    expectBalanced(plan)
    expect(applyToBalances('me', balances, plan)).toEqual({ amit: 0, neha: 0 })
  })

  it('handles balances running both ways when I pay the couple', () => {
    // I owe Amit 500, Neha owes me 200: I owe the couple 300 overall.
    const balances = { amit: -500, neha: 200 }
    const plan = planHouseholdPayment({ single: 'me', actor: 'amit', members: ['amit', 'neha'], balances, amount: 300, payer: 'single' })
    expectBalanced(plan)
    expect(applyToBalances('me', balances, plan)).toEqual({ amit: 0, neha: 0 })
  })

  it('applies partial payments to the actor first, then the largest balance', () => {
    const balances = { amit: 100, neha: 400, kid: 50 }
    const plan = planHouseholdPayment({
      single: 'me',
      actor: 'amit',
      members: ['amit', 'neha', 'kid'],
      balances,
      amount: 300,
      payer: 'household',
    })
    expectBalanced(plan)
    expect(applyToBalances('me', balances, plan)).toEqual({ amit: 0, neha: 200, kid: 50 })
  })

  it('books overpayment on the actor', () => {
    const balances = { amit: 100, neha: 100 }
    const plan = planHouseholdPayment({ single: 'me', actor: 'neha', members: ['amit', 'neha'], balances, amount: 500, payer: 'household' })
    expectBalanced(plan)
    expect(applyToBalances('me', balances, plan)).toEqual({ amit: 0, neha: -300 })
  })

  it('always conserves money', () => {
    const members = ['a', 'b', 'c']
    for (let i = 0; i < 300; i++) {
      const balances = Object.fromEntries(members.map((m) => [m, Math.round(Math.sin(i * 7 + m.charCodeAt(0)) * 1000)]))
      const plan = planHouseholdPayment({
        single: 'me',
        actor: members[i % 3],
        members,
        balances,
        amount: 1 + (i * 37) % 2000,
        payer: i % 2 ? 'single' : 'household',
      })
      expectBalanced(plan)
    }
  })
})

describe('whoPaysNext', () => {
  it('picks whoever is furthest behind', () => {
    expect(whoPaysNext({ a: 300, b: -100, c: -200 })).toEqual({ personId: 'c', behindBy: 200 })
    expect(whoPaysNext({ a: 0, b: 0 })).toBeNull()
  })
})

describe('upiPayLink', () => {
  it('builds a standard UPI intent', () => {
    expect(upiPayLink({ upiId: 'ravi@okaxis', name: 'Ravi K', amount: 12350, note: 'Hisaab settle' })).toBe(
      'upi://pay?pa=ravi%40okaxis&pn=Ravi%20K&am=123.50&cu=INR&tn=Hisaab%20settle',
    )
  })
})
