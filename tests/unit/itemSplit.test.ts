import { describe, expect, it } from 'vitest'
import { fromStoredItems, NO_EXTRAS, percentOf, splitItems, toStoredItems, type BillLine } from '../../src/lib/itemSplit'
import { buildSplit, type SplitUnit } from '../../src/lib/split'

const person = (id: string): SplitUnit => ({ key: id, repId: id, memberIds: [id] })
const pair: SplitUnit = { key: 'h:1', repId: 'c', memberIds: ['c', 'd'] }
const line = (name: string, amount: number, unitKeys: string[]): BillLine => ({ key: name, name, amount, unitKeys })

describe('splitItems', () => {
  const units = [person('a'), person('b'), person('e')]

  it('splits each item between the people who had it', () => {
    const result = splitItems(units, [line('Pizza', 60000, ['a', 'b', 'e']), line('Beer', 30000, ['b'])], NO_EXTRAS)
    expect(result).toEqual({ ok: true, total: 90000, subtotal: 90000, owedByUnit: { a: 20000, b: 50000, e: 20000 } })
  })

  it('spreads tax and tip by what each had, and takes discounts off the same way', () => {
    const lines = [line('Thali', 30000, ['a']), line('Steak', 90000, ['b'])]
    const withTax = splitItems(units, lines, { tax: 12000, tip: 0, discount: 0 })
    expect(withTax.ok && withTax.owedByUnit).toEqual({ a: 33000, b: 99000, e: 0 })
    const withDiscount = splitItems(units, lines, { tax: 0, tip: 0, discount: 20000 })
    expect(withDiscount.ok && withDiscount.owedByUnit).toEqual({ a: 25000, b: 75000, e: 0 })
  })

  it('always adds up to the bill to the paisa', () => {
    const lines = [line('Chai', 1000, ['a', 'b', 'e']), line('Samosa', 1700, ['a', 'e']), line('Bun', 333, ['b'])]
    const result = splitItems(units, lines, { tax: 151, tip: 1000, discount: 7 })
    if (!result.ok) throw new Error(result.error)
    expect(Object.values(result.owedByUnit).reduce((s, x) => s + x, 0)).toBe(result.total)
    expect(result.total).toBe(1000 + 1700 + 333 + 151 + 1000 - 7)
  })

  it('counts a pair as its members on shared items', () => {
    const result = splitItems([person('a'), pair], [line('Biryani', 90000, ['a', 'h:1'])], NO_EXTRAS)
    expect(result.ok && result.owedByUnit).toEqual({ a: 30000, 'h:1': 60000 })
  })

  it('ignores people who were removed from the bill, and asks when nobody is left', () => {
    expect(splitItems(units, [line('Pizza', 1000, ['a', 'gone'])], NO_EXTRAS)).toMatchObject({ ok: true, owedByUnit: { a: 1000 } })
    expect(splitItems(units, [line('Pizza', 1000, ['gone'])], NO_EXTRAS)).toEqual({ ok: false, error: 'Pick who had each item' })
  })

  it('explains what is missing', () => {
    expect(splitItems(units, [], NO_EXTRAS)).toEqual({ ok: false, error: 'Add the items on the bill' })
    expect(splitItems(units, [line('', 0, ['a'])], NO_EXTRAS)).toEqual({ ok: false, error: 'Add the items on the bill' })
    expect(splitItems(units, [line('Naan', 0, ['a'])], NO_EXTRAS)).toEqual({ ok: false, error: 'Give every item a price' })
    expect(splitItems(units, [line('Naan', 1000, ['a'])], { tax: 0, tip: 0, discount: 1000 })).toEqual({
      ok: false,
      error: 'The discount is more than the bill',
    })
  })

  it('feeds buildSplit so the payer is credited', () => {
    const result = splitItems(units, [line('Pizza', 60000, ['a', 'b', 'e']), line('Beer', 30000, ['b'])], NO_EXTRAS)
    if (!result.ok) throw new Error(result.error)
    const split = buildSplit({ amount: result.total, mode: 'exact', units, values: result.owedByUnit, payers: { a: 90000 } })
    expect(split.ok && split.parts).toEqual([
      { person_id: 'a', paid: 90000, owed: 20000, shares: null },
      { person_id: 'b', paid: 0, owed: 50000, shares: null },
      { person_id: 'e', paid: 0, owed: 20000, shares: null },
    ])
  })
})

describe('stored items', () => {
  it('round-trips through what the database keeps, with pairs becoming people', () => {
    const lines = [line('  Biryani ', 90000, ['a', 'h:1']), line('', 500, ['a']), line('Empty', 0, ['a'])]
    const stored = toStoredItems([person('a'), pair], lines, { tax: 100, tip: 0, discount: 0 })
    expect(stored).toEqual({
      lines: [
        { name: 'Biryani', amount: 90000, people: ['a', 'c', 'd'] },
        { name: 'Item 2', amount: 500, people: ['a'] },
      ],
      tax: 100,
      tip: 0,
      discount: 0,
    })
    const back = fromStoredItems(stored)
    expect(back.personIds).toEqual(['a', 'c', 'd'])
    expect(back.lines[0]).toEqual({ key: 'l0', name: 'Biryani', amount: 90000, unitKeys: ['a', 'c', 'd'] })
    expect(back.extras).toEqual({ tax: 100, tip: 0, discount: 0 })
  })

  it('works out percentages to the paisa', () => {
    expect(percentOf(123456, 5)).toBe(6173)
    expect(percentOf(100000, 18)).toBe(18000)
  })
})
