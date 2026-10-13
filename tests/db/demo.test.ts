import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb, type TestUser } from './harness'

const demoSql = (name: string) => readFileSync(join(import.meta.dirname, '..', '..', 'supabase', 'demo', name), 'utf8')

let db: TestDb
let me: TestUser
let realFriend: TestUser

beforeAll(async () => {
  db = await createTestDb()
  // Someone else signed in earlier; the demo must go to the latest sign-in (me).
  const other = await db.signUp('Earlier User', '+919700000001')
  await db.admin(`update auth.users set email = 'earlier@example.com', last_sign_in_at = now() - interval '1 day' where id = $1`, [other.uid])
  me = await db.signUp('Vikas', '+919700000002')
  await db.admin(`update auth.users set email = 'me@example.com', last_sign_in_at = now() where id = $1`, [me.uid])
  realFriend = await db.signUp('Real Friend', '+919700000003')
  await db.as(me, 'select public.add_contact($1, $2)', [realFriend.phone, 'Real'])
  await db.as(me, `select public.save_expense(null, 'Real lunch', 10000, current_date, null, 'equal', $1::jsonb)`, [
    JSON.stringify([
      { person_id: me.personId, paid: 10000, owed: 5000 },
      { person_id: realFriend.personId, paid: 0, owed: 5000 },
    ]),
  ])
})
afterAll(async () => {
  await db?.close()
})

const balances = async () =>
  Object.fromEntries(
    (await db.as<{ display_name: string; net: string }>(
      me,
      'select p.display_name, b.net from public.my_balances() b join public.my_people() p on p.id = b.person_id',
    )).map((r) => [r.display_name, Number(r.net)]),
  )

describe('demo data', () => {
  it('fills the most recent account with every kind of scenario', async () => {
    await db.admin(demoSql('seed_demo.sql'))
    const links = await db.admin<{ name: string }>(
      `select p.name from public.share_links s join public.people p on p.id = s.person_id where s.owner_id = $1 order by p.name`,
      [me.personId],
    )
    expect(links.map((l) => l.name)).toEqual(['Kabir', 'Rahul Verma'])

    await db.as(me, 'select public.run_due_recurring()')
    const b = await balances()
    expect(Object.keys(b).sort()).toEqual(['Amit', 'Bunty (Rahul’s cousin)', 'Deepak', 'Ishita', 'Kabir', 'Neha', 'Priya', 'Rahul', 'Real', 'Sneha'])
    expect(b.Kabir).toBe(150000) // owes you, for a month → reminder
    expect(b.Amit).toBe(-26300) // exact: you owe ₹263
    expect(b.Real).toBe(5000) // own data untouched
    expect(b['Bunty (Rahul’s cousin)']).toBe(50000) // a friend with no number
    const forOthers = await db.as<{ n: number }>(me, `select count(*)::int as n from public.search_entries('movie ticket')`)
    expect(forOthers[0].n).toBe(1) // logged for Rahul & Priya, not involving you
    const rides = await db.as<{ n: number }>(me, `select count(*)::int as n from public.carpool_trips`)
    expect(rides[0].n).toBeGreaterThanOrEqual(8)

    const nudgeable = await db.as<{ n: number }>(
      me,
      `select count(*)::int as n from public.my_balances() b join public.my_people() p on p.id = b.person_id
       where p.display_name = 'Kabir' and b.last_activity < now() - interval '14 days'`,
    )
    expect(nudgeable[0].n).toBe(1)
    const reviews = await db.as<{ description: string; state: string }>(me, 'select description, state from public.my_reviews()')
    expect(reviews.map((r) => r.description)).toEqual(expect.arrayContaining(['🚕 Uber pool', '🎤 Concert tickets', '🛒 DMart groceries']))
    const groups = await db.as<{ name: string; kind: string }>(me, 'select name, kind from public.groups order by name')
    expect(groups).toEqual([
      { name: 'Car pool', kind: 'carpool' },
      { name: 'Flat 302', kind: 'home' },
      { name: 'Goa trip', kind: 'trip' },
      { name: 'Office chai', kind: 'office' },
    ])
    const recurringPosted = await db.as<{ n: number }>(me, `select count(*)::int as n from public.search_entries('Snack box')`)
    expect(recurringPosted[0].n).toBeGreaterThan(0)
    const items = await db.as<{ n: number }>(me, `select count(*)::int as n from public.search_entries('lobster') union all select count(*)::int from public.search_entries('Seafood')`)
    expect(items.map((r) => r.n)).toEqual([0, 1])

    // Running it twice is refused rather than duplicating everything.
    await expect(db.admin(demoSql('seed_demo.sql'))).rejects.toThrow(/already there/)
  })

  it('removes all of it and leaves your own data alone', async () => {
    await db.admin(demoSql('remove_demo.sql'))
    expect(await balances()).toEqual({ Real: 5000 })
    const left = await db.admin<{ n: number }>(
      `select (select count(*) from public.people where phone like '+120255501%')
            + (select count(*) from auth.users where email like '%@demo.hisaab.invalid')
            + (select count(*) from public.people where phone is null)
            + (select count(*) from public.groups) + (select count(*) from public.households) + (select count(*) from public.shortcuts) as n`,
    )
    expect(Number(left[0].n)).toBe(0)
    await db.admin(demoSql('remove_demo.sql')) // safe to repeat
    // And it can be seeded again afterwards.
    await db.admin(demoSql('seed_demo.sql'))
  })
})
