import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb, type TestUser } from './harness'

let db: TestDb
let phoneCounter = 0
const nextPhone = () => `+9195${String(10000000 + phoneCounter++).padStart(8, '0')}`

beforeAll(async () => {
  db = await createTestDb()
})
afterAll(async () => {
  await db?.close()
})

async function carpool(style: 'fare' | 'split' | 'turns' | 'distance', amount: number | null) {
  const users: TestUser[] = []
  for (const name of ['Driver', 'Rider1', 'Rider2', 'Rider3']) users.push(await db.signUp(name, nextPhone()))
  const [d, ...others] = users
  for (const o of others) await db.as(d, 'select public.add_contact($1, $2)', [o.phone, 'x'])
  const [{ id: group }] = await db.as<{ id: string }>(d, `select public.create_group('Car pool', '🚗', $1) as id`, [others.map((o) => o.personId)])
  await db.as(d, 'select public.set_carpool_prefs($1, $2, $3)', [group, style, amount])
  return { group, users }
}

const trip = (user: TestUser, group: string, driver: TestUser, riders: TestUser[], direction = 'am', date = '2026-10-12', amount: number | null = null) =>
  db.as<{ id: string }>(user, 'select public.save_carpool_trip($1, $2, $3, $4, $5, $6) as id', [
    group,
    date,
    direction,
    driver.personId,
    riders.map((r) => r.personId),
    amount,
  ])

const balances = async (user: TestUser, group: string) =>
  Object.fromEntries(
    (await db.as<{ person_id: string; net: string }>(user, 'select person_id, net from public.group_balances($1)', [group])).map((r) => [
      r.person_id,
      Number(r.net),
    ]),
  )

describe('car pool', () => {
  it('distance: each rider pays the driver for their own km at the rate', async () => {
    // Sonika drives; Vikas rides 20 km, Garvit is picked up 14 km from the office. ₹8/km.
    const { group, users } = await carpool('distance', 800)
    const [sonika, vikas, garvit, other] = users
    const km = (by: TestUser, who: TestUser, value: number | null) =>
      db.as(by, 'select public.set_carpool_distance($1, $2, $3)', [group, who.personId, value])
    await km(sonika, sonika, 20)
    await km(sonika, vikas, 20)
    await expect(trip(sonika, group, sonika, [vikas, garvit])).rejects.toThrow(/carpool_km_needed/)
    await km(vikas, garvit, 14) // any member can set anyone's distance
    await expect(km(vikas, garvit, 0)).rejects.toThrow(/invalid_km/)
    await expect(km(vikas, garvit, 501)).rejects.toThrow(/invalid_km/)

    const [{ id }] = await trip(sonika, group, sonika, [vikas, garvit])
    await trip(garvit, group, sonika, [vikas, garvit], 'pm')
    const b = await balances(sonika, group)
    expect(b).toEqual({ [sonika.personId]: 54400, [vikas.personId]: -32000, [garvit.personId]: -22400, [other.personId]: 0 })
    const [row] = await db.as<{ amount: string; total: string }>(sonika, 'select amount, total from public.carpool_trips where id = $1', [id])
    expect(row).toEqual({ amount: '800', total: '27200' })

    // When Vikas drives, Sonika pays for her 20 km; half-km distances round to the paisa.
    await km(garvit, garvit, 13.5)
    await trip(vikas, group, vikas, [sonika, garvit], 'am', '2026-10-13', 750) // ₹7.50/km just this trip
    const after = await balances(sonika, group)
    expect(after[sonika.personId]).toBe(54400 - 15000)
    expect(after[garvit.personId]).toBe(-22400 - 10125)

    await km(sonika, garvit, null)
    expect(await db.as(sonika, 'select person_id from public.carpool_distances where group_id = $1 and person_id = $2', [group, garvit.personId])).toEqual([])
    await expect(km(other, users[0], 10)).resolves.toBeTruthy()
  })


  it('fare: each rider owes the driver the fare, and the driver owes nothing', async () => {
    const { group, users } = await carpool('fare', 8000)
    const [d, r1, r2, r3] = users
    await trip(d, group, d, [r1, r2, r3])
    await trip(r1, group, d, [r1, r2], 'pm') // a rider can log it too
    const b = await balances(d, group)
    expect(b).toEqual({ [d.personId]: 40000, [r1.personId]: -16000, [r2.personId]: -16000, [r3.personId]: -8000 })
    const [entry] = await db.as<{ description: string; amount: string }>(d, `select description, amount from public.entries where group_id = $1 order by created_at limit 1`, [group])
    expect(entry).toEqual({ description: '🚗 Morning ride · 12 Oct', amount: '24000' })
    // A different fare just for one trip.
    await trip(d, group, d, [r3], 'am', '2026-10-13', 12000)
    expect((await balances(d, group))[r3.personId]).toBe(-20000)
  })

  it('split: the trip cost is shared by everyone in the car, extra paise to the driver', async () => {
    const { group, users } = await carpool('split', 10000)
    const [d, r1, r2] = users
    await trip(d, group, d, [r1, r2])
    expect(await balances(d, group)).toEqual({ [d.personId]: 6666, [r1.personId]: -3333, [r2.personId]: -3333, [users[3].personId]: 0 })
  })

  it('turns: no money, just a count of who drove and who rode', async () => {
    const { group, users } = await carpool('turns', null)
    const [a, b, c, e] = users
    await trip(a, group, a, [b, c, e])
    await trip(b, group, b, [a], 'pm')
    const money = await db.as<{ n: number }>(a, 'select count(*)::int as n from public.entries where group_id = $1', [group])
    expect(money[0].n).toBe(0)
    const summary = await db.as<{ person_id: string; drives: number; rides: number; seats: number }>(
      a,
      'select person_id, drives, rides, seats from public.carpool_summary($1)',
      [group],
    )
    const by = Object.fromEntries(summary.map((s) => [s.person_id, [s.drives, s.rides, s.seats]]))
    expect(by).toEqual({ [a.personId]: [1, 1, 2], [b.personId]: [1, 1, 0], [c.personId]: [0, 1, -1], [e.personId]: [0, 1, -1] })
  })

  it('logs each direction once a day, only by someone in the car, and only for members', async () => {
    const { group, users } = await carpool('fare', 5000)
    const [d, r1, r2, r3] = users
    const outsider = await db.signUp('Outsider', nextPhone())
    await trip(d, group, d, [r1])
    await expect(trip(d, group, d, [r2])).rejects.toThrow(/trip_already_logged/)
    await expect(trip(r3, group, d, [r1, r2], 'pm')).rejects.toThrow(/must_participate/)
    await expect(trip(d, group, d, [d], 'pm')).rejects.toThrow(/invalid_trip/)
    await expect(trip(d, group, d, [], 'pm')).rejects.toThrow(/invalid_trip/)
    await expect(trip(d, group, d, [outsider], 'pm')).rejects.toThrow(/not_group_member/)
    await expect(trip(outsider, group, outsider, [d], 'pm')).rejects.toThrow(/group_not_found/)
  })

  it('undo removes the trip and deletes its expense', async () => {
    const { group, users } = await carpool('fare', 5000)
    const [d, r1, r2] = users
    const [{ id }] = await trip(d, group, d, [r1])
    await expect(db.as(r2, 'select public.delete_carpool_trip($1)', [id])).rejects.toThrow(/trip_not_found/)
    await db.as(r1, 'select public.delete_carpool_trip($1)', [id])
    expect((await balances(d, group))[d.personId]).toBe(0)
    const deleted = await db.as<{ n: number }>(d, 'select count(*)::int as n from public.entries where group_id = $1 and deleted_at is not null', [group])
    expect(deleted[0].n).toBe(1)
    await trip(d, group, d, [r1]) // the slot is free again
  })

  it('needs a style before trips, and an amount for money styles', async () => {
    const { group, users } = await carpool('turns', null)
    await expect(db.as(users[0], `select public.set_carpool_prefs($1, 'fare', null)`, [group])).rejects.toThrow(/carpool_amount_needed/)
    const [{ id: plain }] = await db.as<{ id: string }>(users[0], `select public.create_group('Plain', null, $1) as id`, [[users[1].personId]])
    await expect(trip(users[0], plain, users[0], [users[1]])).rejects.toThrow(/not_a_carpool/)
  })

  it('lets members (only) read the trips', async () => {
    const { group, users } = await carpool('turns', null)
    const outsider = await db.signUp('Peek', nextPhone())
    await trip(users[0], group, users[0], [users[1]])
    expect(await db.as(users[2], 'select id from public.carpool_trips where group_id = $1', [group])).toHaveLength(1)
    expect(await db.as(outsider, 'select id from public.carpool_trips where group_id = $1', [group])).toHaveLength(0)
    await expect(db.asRole('anon', `select public.carpool_summary('${group}')`)).rejects.toThrow(/permission denied/)
  })
})
