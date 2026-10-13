import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

let db: TestDb
beforeAll(async () => {
  db = await createTestDb()
})
afterAll(async () => {
  await db?.close()
})

// Must match src/lib/contactMatch.ts.
const hash = (phone: string) => createHash('sha256').update(`hisaab:${phone}`).digest('hex')

describe("who's on Hisaab", () => {
  it('returns only the hashes of people who signed up, never yourself', async () => {
    const me = await db.signUp('Me', '+919300000001')
    await db.signUp('Joined', '+919300000002')
    await db.as(me, `select public.add_contact('+919300000003', 'Not joined')`)
    const asked = ['+919300000001', '+919300000002', '+919300000003', '+919300000004'].map(hash)
    const rows = await db.as<{ match_contacts: string }>(me, 'select public.match_contacts($1)', [asked])
    expect(rows.map((r) => r.match_contacts)).toEqual([hash('+919300000002')])
  })

  it('limits how many numbers one person can check', async () => {
    const me = await db.signUp('Checker', '+919300000010')
    const many = Array.from({ length: 2001 }, (_, i) => hash(`+9193${String(i).padStart(8, '0')}`))
    await expect(db.as(me, 'select public.match_contacts($1)', [many])).rejects.toThrow(/too_many_lookups/)
    const batch = many.slice(0, 2000)
    for (let i = 0; i < 5; i++) await db.as(me, 'select public.match_contacts($1)', [batch])
    await expect(db.as(me, 'select public.match_contacts($1)', [batch.slice(0, 1)])).rejects.toThrow(/too_many_lookups/)
    await expect(db.asRole('anon', `select public.match_contacts('{}')`)).rejects.toThrow(/permission denied/)
  })
})
