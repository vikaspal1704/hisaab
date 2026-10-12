import { describe, expect, it } from 'vitest'
import { formatINR, parseRupees, toRupeeInput } from '../../src/lib/money'
import { formatPhone, normalizePhone } from '../../src/lib/phone'

describe('parseRupees', () => {
  it.each([
    ['100', 10000],
    ['1,250', 125000],
    ['99.5', 9950],
    ['99.05', 9905],
    ['₹ 40', 4000],
    ['.5', 50],
    ['0.01', 1],
  ])('%s -> %i paise', (input, paise) => expect(parseRupees(input)).toBe(paise))

  it.each(['', '0', 'abc', '1.234', '-5', '1e3', '10000001'])('rejects %j', (input) =>
    expect(parseRupees(input)).toBeNull(),
  )

  it('round-trips through the input format', () => {
    for (const p of [1, 50, 100, 12345, 99999]) expect(parseRupees(toRupeeInput(p))).toBe(p)
  })
})

describe('formatINR', () => {
  it('uses Indian grouping and drops .00', () => {
    expect(formatINR(12345600)).toBe('₹1,23,456')
    expect(formatINR(9950)).toBe('₹99.50')
    expect(formatINR(-500)).toBe('−₹5')
    expect(formatINR(500, { signed: true })).toBe('+₹5')
  })
})

describe('normalizePhone', () => {
  it.each([
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['0091 9876543210', '+919876543210'],
    ['+1 (415) 555-0100', '+14155550100'],
  ])('%s -> %s', (input, e164) => expect(normalizePhone(input)).toBe(e164))

  it.each(['', '12345', '+91 12345 67890', 'abc'])('rejects %j', (input) => expect(normalizePhone(input)).toBeNull())

  it('formats Indian numbers for display', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210')
  })
})
