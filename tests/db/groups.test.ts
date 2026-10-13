import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb, type TestUser } from './harness'

let db: TestDb
let phoneCounter = 0
const nextPhone = () => `+9194${String(10000000 + phoneCounter++).padStart(8, '0')}`

beforeAll(async () => {
  db = await createTestDb()
})
afterAll(async () => {
  await db?.close()
})

async function groupOf(...names: string[]) {
  const users: TestUser[] = []
  for (const name of names) users.push(await db.signUp(name, nextPhone()))
  const [owner, ...others] = users
  for (const o of others) await db.as(owner, 'select public.add_contact($1, $2)', [o.phone, 'x'])
  const [{ id }] = await db.as<{ id: string }>(owner, `select public.create_group('Trip', null, $1) as id`, [others.map((o) => o.personId)])
  return { group: id, users }
}

const net = async (a: TestUser, b: TestUser) =>
  Number((await db.as<{ net: string }>(a, 'select net from public.my_balances() where person_id = $1', [b.personId]))[0]?.net ?? 0)

describe('deleting a group', () => {
  it('lets only the creator delete it, and keeps every expense and balance', async () => {
    const { group, users } = await groupOf('Owner', 'Member')
    const [owner, member] = users
    await db.as(member, `select public.save_expense(null, 'Dinner', 10000, current_date, $1, 'equal', $2::jsonb)`, [
      group,
      JSON.stringify([
        { person_id: member.personId, paid: 10000, owed: 5000 },
        { person_id: owner.personId, paid: 0, owed: 5000 },
      ]),
    ])
    await db.as(owner, `select public.save_recurring(null, $1, 'Rent', 10000, 'equal', $2::jsonb, 1, current_date + 5)`, [
      group,
      JSON.stringify([
        { person_id: owner.personId, paid: 10000, owed: 5000 },
        { person_id: member.personId, paid: 0, owed: 5000 },
      ]),
    ])

    await expect(db.as(member, 'select public.delete_group($1)', [group])).rejects.toThrow(/only_group_creator/)
    await db.as(owner, 'select public.delete_group($1)', [group])

    expect(await db.as(owner, 'select id from public.groups where id = $1', [group])).toEqual([])
    expect(await net(owner, member)).toBe(-5000)
    const [entry] = await db.as<{ group_id: string | null; deleted_at: string | null }>(
      member,
      `select group_id, deleted_at from public.entries where description = 'Dinner'`,
    )
    expect(entry).toEqual({ group_id: null, deleted_at: null })
    expect(await db.admin(`select id from public.recurring_rules where group_id = $1`, [group])).toEqual([])
    await expect(db.as(owner, 'select public.delete_group($1)', [group])).rejects.toThrow(/group_not_found/)
  })
})

describe('leaving a group', () => {
  it('needs you to be square, and the creator deletes instead', async () => {
    const { group, users } = await groupOf('Lead', 'Leaver', 'Stayer')
    const [lead, leaver] = users
    await db.as(lead, `select public.save_expense(null, 'Fuel', 6000, current_date, $1, 'equal', $2::jsonb)`, [
      group,
      JSON.stringify([
        { person_id: lead.personId, paid: 6000, owed: 3000 },
        { person_id: leaver.personId, paid: 0, owed: 3000 },
      ]),
    ])
    await expect(db.as(leaver, 'select public.leave_group($1)', [group])).rejects.toThrow(/settle_before_leaving/)
    await expect(db.as(lead, 'select public.leave_group($1)', [group])).rejects.toThrow(/creator_cannot_leave/)

    await db.as(leaver, `select public.save_payment(null, $1, $2, 3000, current_date, 'upi', null, null, $3)`, [leaver.personId, lead.personId, group])
    await db.as(leaver, 'select public.leave_group($1)', [group])
    expect(await db.as(leaver, 'select id from public.groups where id = $1', [group])).toEqual([])
    const members = await db.as<{ n: number }>(lead, 'select count(*)::int as n from public.group_members where group_id = $1', [group])
    expect(members[0].n).toBe(2)
  })
})
