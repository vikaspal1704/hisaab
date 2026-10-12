import { describe, expect, it } from 'vitest'
import { formatDay, formatRelative, todayISO } from '../../src/lib/format'

describe('dates', () => {
  it('uses the local calendar day', () => {
    expect(todayISO(new Date(2026, 0, 5, 1, 0))).toBe('2026-01-05')
  })

  it('omits the year for this year', () => {
    const now = new Date(2026, 9, 12)
    expect(formatDay('2026-10-01', now)).toBe('1 Oct')
    expect(formatDay('2025-10-01', now)).toBe('1 Oct 2025')
  })

  it('describes recent times', () => {
    const now = new Date(2026, 9, 12, 12, 0)
    expect(formatRelative(new Date(2026, 9, 12, 11, 59, 30).toISOString(), now)).toBe('just now')
    expect(formatRelative(new Date(2026, 9, 12, 11, 40).toISOString(), now)).toBe('20 min ago')
    expect(formatRelative(new Date(2026, 9, 11, 20, 0).toISOString(), now)).toBe('yesterday')
  })
})
