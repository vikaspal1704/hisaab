import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashPhone } from '../../src/lib/contactMatch'

describe('hashPhone', () => {
  it('matches the database (sha256 of "hisaab:" + number, hex)', async () => {
    const expected = createHash('sha256').update('hisaab:+919876543210').digest('hex')
    expect(await hashPhone('+919876543210')).toBe(expected)
  })
})
