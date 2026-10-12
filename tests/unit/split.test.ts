import { describe, expect, it } from 'vitest'
import { buildSplit, splitByWeights, type SplitUnit } from '../../src/lib/split'

const person = (id: string): SplitUnit => ({ key: id, repId: id, memberIds: [id] })

describe('splitByWeights', () => {
  it('always adds up exactly and hands out leftover paise in order', () => {
    expect(splitByWeights(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(splitByWeights(1000, [2, 1])).toEqual([667, 333])
    for (let amount = 1; amount < 500; amount += 7) {
      const parts = splitByWeights(amount, [1, 2.5, 3, 0])
      expect(parts.reduce((s, p) => s + p, 0)).toBe(amount)
      expect(parts[3]).toBe(0)
    }
  })

  it('rejects nonsense weights', () => {
    expect(() => splitByWeights(100, [0, 0])).toThrow()
    expect(() => splitByWeights(100, [-1, 2])).toThrow()
  })
})

describe('buildSplit', () => {
  it('splits equally with the payer', () => {
    const r = buildSplit({
      amount: 30000,
      mode: 'equal',
      units: [person('me'), person('a'), person('b')],
      values: {},
      payers: { me: 30000 },
    })
    expect(r).toEqual({
      ok: true,
      owedByUnit: { me: 10000, a: 10000, b: 10000 },
      parts: [
        { person_id: 'me', paid: 30000, owed: 10000, shares: null },
        { person_id: 'a', paid: 0, owed: 10000, shares: null },
        { person_id: 'b', paid: 0, owed: 10000, shares: null },
      ],
    })
  })

  it('counts a couple as one unit with two shares, booked on whoever of them paid', () => {
    const couple: SplitUnit = { key: 'h1', repId: 'amit', memberIds: ['amit', 'neha'] }
    const r = buildSplit({ amount: 90000, mode: 'equal', units: [person('me'), couple], values: {}, payers: { neha: 90000 } })
    if (!r.ok) throw new Error(r.error)
    expect(r.owedByUnit).toEqual({ me: 30000, h1: 60000 })
    // Neha paid, so the couple's share sits with Neha: nobody inside the couple owes the other.
    expect(r.parts).toEqual([
      { person_id: 'me', paid: 0, owed: 30000, shares: null },
      { person_id: 'neha', paid: 90000, owed: 60000, shares: null },
    ])
  })

  it('supports exact amounts and shares', () => {
    const exact = buildSplit({
      amount: 1000,
      mode: 'exact',
      units: [person('me'), person('a')],
      values: { me: 400, a: 600 },
      payers: { me: 1000 },
    })
    expect(exact.ok && exact.owedByUnit).toEqual({ me: 400, a: 600 })

    const shares = buildSplit({
      amount: 1000,
      mode: 'shares',
      units: [person('me'), person('a')],
      values: { me: 1, a: 3 },
      payers: { a: 1000 },
    })
    expect(shares.ok && shares.parts).toEqual([
      { person_id: 'me', paid: 0, owed: 250, shares: 1 },
      { person_id: 'a', paid: 1000, owed: 750, shares: 3 },
    ])
  })

  it('explains invalid input', () => {
    const base = { amount: 1000, mode: 'exact' as const, units: [person('me'), person('a')], payers: { me: 1000 } }
    expect(buildSplit({ ...base, values: { me: 400, a: 500 } })).toEqual({
      ok: false,
      error: 'Split amounts must add up to the total',
    })
    expect(buildSplit({ ...base, payers: { me: 900 }, values: { me: 500, a: 500 } }).ok).toBe(false)
    expect(buildSplit({ ...base, mode: 'equal', units: [person('me')], values: {} }).ok).toBe(false)
  })
})
