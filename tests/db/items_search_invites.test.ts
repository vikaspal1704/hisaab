import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb, type TestUser } from './harness'

let db: TestDb
let phoneCounter = 0
const nextPhone = () => `+9196${String(10000000 + phoneCounter++).padStart(8, '0')}`

beforeAll(async () => {
  db = await createTestDb()
})
afterAll(async () => {
  await db?.close()
})

async function friends(...names: string[]) {
  const users: TestUser[] = []
  for (const name of names) users.push(await db.signUp(name, nextPhone()))
  for (const a of users)
    for (const b of users) if (a !== b) await db.as(a, 'select public.add_contact($1, $2)', [b.phone, 'x'])
  return users
}

function itemized(user: TestUser, args: { entry?: string | null; parts: unknown[]; items: unknown; group?: string | null; version?: number | null }) {
  return db.as<{ id: string }>(
    user,
    `select public.save_itemized_expense($1, 'Dinner', current_date, $2, $3::jsonb, $4::jsonb, $5) as id`,
    [args.entry ?? null, args.group ?? null, JSON.stringify(args.parts), JSON.stringify(args.items), args.version ?? null],
  )
}

describe('split by item', () => {
  it('stores the bill next to the parts and books what each person had', async () => {
    const [a, b, c] = await friends('Ia', 'Ib', 'Ic')
    // Pizza 600 for all three, beer 300 for b only, 10% tax (90), 0 tip, discount 30 → 960.
    const items = {
      lines: [
        { name: ' Pizza ', amount: 60000, people: [a.personId, b.personId, c.personId] },
        { name: 'Beer', amount: 30000, people: [b.personId] },
      ],
      tax: 9000,
      tip: 0,
      discount: 3000,
    }
    const parts = [
      { person_id: a.personId, paid: 96000, owed: 20000 },
      { person_id: b.personId, paid: 0, owed: 50000 },
      { person_id: c.personId, paid: 0, owed: 26000 },
    ]
    const [{ id }] = await itemized(a, { parts, items })
    const [entry] = await db.as<{ amount: string; split_mode: string; items: typeof items }>(
      b,
      'select amount, split_mode, items from public.entries where id = $1',
      [id],
    )
    expect(entry.amount).toBe('96000')
    expect(entry.split_mode).toBe('items')
    expect(entry.items.lines[0].name).toBe('Pizza')
    expect(entry.items.discount).toBe(3000)

    const balances = await db.as<{ person_id: string; net: string }>(a, 'select person_id, net from public.my_balances()')
    expect(Object.fromEntries(balances.map((r) => [r.person_id, Number(r.net)]))).toEqual({ [b.personId]: 50000, [c.personId]: 26000 })
  })

  it('rejects bills that do not add up or name strangers', async () => {
    const [a, b] = await friends('Ja', 'Jb')
    const stranger = await db.signUp('Jz', nextPhone())
    const parts = [
      { person_id: a.personId, paid: 10000, owed: 5000 },
      { person_id: b.personId, paid: 0, owed: 5000 },
    ]
    const line = (amount: unknown, people: unknown[] = [a.personId, b.personId]) => ({ name: 'Thali', amount, people })
    // Parts total 100 but the items say 120.
    await expect(itemized(a, { parts, items: { lines: [line(12000)] } })).rejects.toThrow(/split_mismatch/)
    await expect(itemized(a, { parts, items: { lines: [line(100.5)] } })).rejects.toThrow(/invalid_items/)
    await expect(itemized(a, { parts, items: { lines: [line(10000, [])] } })).rejects.toThrow(/invalid_items/)
    await expect(itemized(a, { parts, items: { lines: [line(10000, ['nope'])] } })).rejects.toThrow(/invalid_items/)
    await expect(itemized(a, { parts, items: { lines: [] } })).rejects.toThrow(/invalid_items/)
    await expect(itemized(a, { parts, items: { lines: [line(10000)], discount: 10000 } })).rejects.toThrow(/invalid_items/)
    await expect(itemized(a, { parts, items: { lines: [line(10000)], tax: -5 } })).rejects.toThrow(/invalid_items/)
    await expect(itemized(a, { parts, items: { lines: [line(10000, [stranger.personId])] } })).rejects.toThrow(/unknown_person/)
    await expect(itemized(a, { parts, items: { lines: [line(10000, [randomUUID()])] } })).rejects.toThrow(/unknown_person/)
    await itemized(a, { parts, items: { lines: [line(10000)] } })
  })

  it('drops the item list when the bill is re-saved another way', async () => {
    const [a, b] = await friends('Ka', 'Kb')
    const parts = [
      { person_id: a.personId, paid: 10000, owed: 5000 },
      { person_id: b.personId, paid: 0, owed: 5000 },
    ]
    const [{ id }] = await itemized(a, { parts, items: { lines: [{ name: 'Thali', amount: 10000, people: [a.personId, b.personId] }] } })
    await db.as(a, `select public.save_expense($1, 'Dinner', 10000, current_date, null, 'equal', $2::jsonb, 1)`, [id, JSON.stringify(parts)])
    const [entry] = await db.as<{ split_mode: string; items: unknown; version: number }>(
      a,
      'select split_mode, items, version from public.entries where id = $1',
      [id],
    )
    expect(entry).toEqual({ split_mode: 'equal', items: null, version: 2 })

    // And back to items, with the version check still applied.
    await expect(
      itemized(a, { entry: id, version: 1, parts, items: { lines: [{ name: 'Thali', amount: 10000, people: [b.personId] }] } }),
    ).rejects.toThrow(/stale_entry|version/)
    await itemized(a, { entry: id, version: 2, parts, items: { lines: [{ name: 'Thali', amount: 10000, people: [a.personId, b.personId] }] } })
    const [again] = await db.as<{ split_mode: string }>(a, 'select split_mode from public.entries where id = $1', [id])
    expect(again.split_mode).toBe('items')
  })

  it('is not callable without signing in', async () => {
    await expect(
      db.asRole('anon', `select public.save_itemized_expense(null, 'x', null, null, '[]', '{}')`),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('search', () => {
  it('finds my entries by what, item, group, friend or amount — and nobody else’s', async () => {
    const [a, b, c] = await friends('Sa', 'Sb', 'Sc')
    const parts = (payer: TestUser, other: TestUser, amount: number) => [
      { person_id: payer.personId, paid: amount, owed: amount / 2 },
      { person_id: other.personId, paid: 0, owed: amount / 2 },
    ]
    await db.as(a, `select public.save_expense(null, 'Goa 100% fun_trip', 45000, current_date, null, 'equal', $1::jsonb)`, [
      JSON.stringify(parts(a, b, 45000)),
    ])
    await itemized(a, {
      parts: parts(a, b, 20000),
      items: { lines: [{ name: 'Masala dosa', amount: 20000, people: [a.personId, b.personId] }] },
    })
    // b and c's private entry: a must never find it.
    await db.as(b, `select public.save_expense(null, 'Secret dosa', 8000, current_date, null, 'equal', $1::jsonb)`, [
      JSON.stringify(parts(b, c, 8000)),
    ])

    const search = async (user: TestUser, q: string) =>
      (await db.as<{ description: string }>(user, 'select description from public.search_entries($1)', [q])).map((r) => r.description)

    expect(await search(a, 'goa')).toEqual(['Goa 100% fun_trip'])
    expect(await search(a, 'DOSA')).toEqual(['Dinner'])
    expect(await search(a, '₹450')).toEqual(['Goa 100% fun_trip'])
    expect(await search(a, '450.00')).toEqual(['Goa 100% fun_trip'])
    expect((await search(a, 'x')).sort()).toEqual(['Dinner', 'Goa 100% fun_trip']) // friend's nickname is "x"
    // LIKE wildcards are matched literally.
    expect(await search(a, '%')).toEqual(['Goa 100% fun_trip'])
    expect(await search(a, '_')).toEqual(['Goa 100% fun_trip'])
    expect(await search(a, '   ')).toEqual([])
    expect(await search(c, 'dosa')).toEqual(['Secret dosa'])

    // Deleted entries don't come up.
    const [{ entry_id }] = await db.as<{ entry_id: string }>(a, `select entry_id from public.search_entries('goa')`)
    await db.as(a, 'select public.delete_entry($1)', [entry_id])
    expect(await search(a, 'goa')).toEqual([])
  })
})

describe('group statement', () => {
  it('lists every group entry with who paid and each member’s effect, for members only', async () => {
    const [a, b, c] = await friends('Ga', 'Gb', 'Gc')
    const outsider = await db.signUp('Gz', nextPhone())
    const [{ id: group }] = await db.as<{ id: string }>(a, `select public.create_group('Goa', null, $1) as id`, [[b.personId, c.personId]])
    // b pays for b and c only: a is not on this entry but still sees it in the group statement.
    await db.as(b, `select public.save_expense(null, 'Scooty', 6000, '2026-10-01', $1, 'equal', $2::jsonb)`, [
      group,
      JSON.stringify([
        { person_id: b.personId, paid: 6000, owed: 3000 },
        { person_id: c.personId, paid: 0, owed: 3000 },
      ]),
    ])
    await db.as(c, `select public.save_payment(null, $1, $2, 3000, '2026-10-02', 'upi', null, null, $3)`, [c.personId, b.personId, group])

    const rows = await db.as<{ description: string; kind: string; payers: Record<string, number>; effects: Record<string, number> }>(
      a,
      'select description, kind, payers, effects from public.group_statement($1)',
      [group],
    )
    expect(rows).toEqual([
      { description: 'Scooty', kind: 'expense', payers: { [b.personId]: 6000 }, effects: { [b.personId]: 3000, [c.personId]: -3000 } },
      { description: expect.any(String), kind: 'payment', payers: { [c.personId]: 3000 }, effects: { [b.personId]: -3000, [c.personId]: 3000 } },
    ])
    expect(await db.as(outsider, 'select * from public.group_statement($1)', [group])).toEqual([])
  })
})

describe('friends who join later', () => {
  async function pendingFriend() {
    const a = await db.signUp('Owner', nextPhone())
    const phone = nextPhone()
    const [{ id: friendId }] = await db.as<{ id: string }>(a, 'select public.add_contact($1, $2) as id', [phone, 'Rahul'])
    return { a, phone, friendId }
  }

  async function addHistory(a: TestUser, friendId: string) {
    const parts = [
      { person_id: a.personId, paid: 10000, owed: 5000 },
      { person_id: friendId, paid: 0, owed: 5000 },
    ]
    await db.as(a, `select public.save_expense(null, 'Chai', 10000, current_date, null, 'equal', $1::jsonb)`, [JSON.stringify(parts)])
  }

  async function newLogin(phone = '') {
    const uid = randomUUID()
    await db.admin('insert into auth.users (id) values ($1)', [uid])
    return { uid, phone }
  }

  it('lets anyone take a number that only sits in someone’s contacts', async () => {
    const { phone, friendId } = await pendingFriend()
    const user = await newLogin()
    const [{ id }] = await db.as<{ id: string }>(user, 'select public.claim_profile($1, $2) as id', ['Rahul', phone])
    expect(id).toBe(friendId)
  })

  it('needs an invite link (or OTP) to take over a number that already has history', async () => {
    const { a, phone, friendId } = await pendingFriend()
    await addHistory(a, friendId)

    const google = await newLogin()
    await expect(db.as(google, 'select public.claim_profile($1, $2)', ['Rahul', phone])).rejects.toThrow(/phone_needs_invite/)
    await expect(db.as(google, `select public.claim_profile($1, $2, null, 'bogus')`, ['Rahul', phone])).rejects.toThrow(
      /phone_needs_invite/,
    )

    // A link for someone else doesn't count.
    const other = await pendingFriend()
    const [{ token: otherToken }] = await db.as<{ token: string }>(other.a, 'select public.create_share_link($1) as token', [other.friendId])
    await expect(db.as(google, 'select public.claim_profile($1, $2, null, $3)', ['Rahul', phone, otherToken])).rejects.toThrow(
      /phone_needs_invite/,
    )

    // Nor does a link that was turned off.
    const [{ token: revoked }] = await db.as<{ token: string }>(a, 'select public.create_share_link($1) as token', [friendId])
    await db.as(a, 'select public.revoke_share_link($1)', [friendId])
    await expect(db.as(google, 'select public.claim_profile($1, $2, null, $3)', ['Rahul', phone, revoked])).rejects.toThrow(
      /phone_needs_invite/,
    )

    const [{ token }] = await db.as<{ token: string }>(a, 'select public.create_share_link($1) as token', [friendId])
    const [{ id }] = await db.as<{ id: string }>(google, 'select public.claim_profile($1, $2, null, $3) as id', ['Rahul', phone, token])
    expect(id).toBe(friendId)
    const balances = await db.as<{ person_id: string; net: string }>(google, 'select person_id, net from public.my_balances()')
    expect(balances).toEqual([{ person_id: a.personId, net: '-5000' }])
  })

  it('accepts a verified (OTP) number without an invite', async () => {
    const { a, phone, friendId } = await pendingFriend()
    await addHistory(a, friendId)
    const otp = await newLogin(phone.slice(1))
    const [{ id }] = await db.as<{ id: string }>(otp, 'select public.claim_profile($1, $2) as id', ['Rahul', phone])
    expect(id).toBe(friendId)
  })

  it('keeps profile updates working with the old three-argument call', async () => {
    const user = await db.signUp('Up', nextPhone())
    await db.as(user, `select public.claim_profile('Up Dated', $1, 'up@okaxis')`, [user.phone])
    const [me] = await db.as<{ display_name: string; upi_id: string }>(user, 'select display_name, upi_id from public.my_people() where is_me')
    expect(me).toEqual({ display_name: 'Up Dated', upi_id: 'up@okaxis' })
  })
})
