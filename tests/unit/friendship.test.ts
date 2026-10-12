import { describe, expect, it } from 'vitest'
import { balanceLabel, relationState } from '../../src/lib/baari'
import { nudgeMessage, shouldNudge } from '../../src/lib/nudge'
import { matchPayee, parsePaymentText } from '../../src/lib/paymentText'

describe('baari', () => {
  it('treats small differences as even', () => {
    expect(relationState(3700, 10000)).toEqual({ kind: 'even', amount: 3700 })
    expect(relationState(-20000, 10000)).toEqual({ kind: 'i_owe', amount: 20000 })
    expect(relationState(0, 0)).toEqual({ kind: 'even', amount: 0 })
  })

  it('talks in turns for baari friends and debts for exact ones', () => {
    expect(balanceLabel(50000, 'baari', 10000)).toEqual({ top: 'their baari', tone: 'owed' })
    expect(balanceLabel(-50000, 'baari', 10000)).toEqual({ top: 'your baari', tone: 'owe' })
    expect(balanceLabel(5000, 'baari', 10000)).toEqual({ top: 'barabar 👍', tone: 'even' })
    expect(balanceLabel(5000, 'exact', 10000)).toEqual({ top: 'owes you', tone: 'owed' })
    expect(balanceLabel(0, 'exact', 0)).toEqual({ top: 'settled up', tone: 'even' })
  })
})

describe('parsePaymentText', () => {
  it.each([
    ['₹450 paid to Rahul Verma', { amount: 45000, payeeName: 'Rahul Verma', upiId: null }],
    ['Paid ₹ 1,250.50 to RAHUL VERMA on 12 Oct 2026. UPI transaction ID: 6291', { amount: 125050, payeeName: 'Rahul Verma', upiId: null }],
    ['Rs.450.00 debited from A/c XX1234 on 12-10-26 to VPA rahul@okaxis (UPI Ref No 1234)', { amount: 45000, payeeName: null, upiId: 'rahul@okaxis' }],
    ['INR 99 paid successfully to Amit via PhonePe', { amount: 9900, payeeName: 'Amit', upiId: null }],
    ['Hello there', { amount: null, payeeName: null, upiId: null }],
  ])('%s', (text, expected) => expect(parsePaymentText(text)).toEqual(expected))

  it('matches the payee by UPI ID first, then by name', () => {
    const people = [
      { id: '1', display_name: 'Rahul', upi_id: 'rahul@okaxis' },
      { id: '2', display_name: 'Amit Kumar', upi_id: null },
    ]
    expect(matchPayee({ amount: 1, payeeName: null, upiId: 'rahul@okaxis' }, people)?.id).toBe('1')
    expect(matchPayee({ amount: 1, payeeName: 'Amit Kumar', upiId: null }, people)?.id).toBe('2')
    expect(matchPayee({ amount: 1, payeeName: 'Rahul Verma', upiId: null }, people)?.id).toBe('1')
    expect(matchPayee({ amount: 1, payeeName: 'Zoya', upiId: null }, people)).toBeNull()
  })
})

describe('nudges', () => {
  const prefs = { remind_above: 50000, remind_after_days: 14, last_nudged_at: null }
  const now = new Date('2026-10-12T12:00:00Z')
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString()

  it('waits for a real amount and a quiet spell', () => {
    expect(shouldNudge(60000, daysAgo(20), prefs, now)).toBe(true)
    expect(shouldNudge(40000, daysAgo(20), prefs, now)).toBe(false)
    expect(shouldNudge(60000, daysAgo(3), prefs, now)).toBe(false)
    expect(shouldNudge(60000, daysAgo(20), { ...prefs, last_nudged_at: daysAgo(2) }, now)).toBe(false)
    expect(shouldNudge(-60000, daysAgo(20), prefs, now)).toBe(false)
  })

  it('writes a light message with UPI and link', () => {
    const text = nudgeMessage({ name: 'Rahul Verma', amount: 52000, tone: 'baari', myUpi: 'me@okaxis', link: 'https://x/s/1' })
    expect(text).toContain('Rahul bhai, next baari teri')
    expect(text).toContain('₹520')
    expect(text).toContain('UPI: me@okaxis')
    expect(text).toContain('https://x/s/1')
  })
})
