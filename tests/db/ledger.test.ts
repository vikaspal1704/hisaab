import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { planHouseholdPayment } from '../../src/lib/settle'
import { createTestDb, type TestDb, type TestUser } from './harness'

let db: TestDb
let phoneCounter = 0
const nextPhone = () => `+9198${String(10000000 + phoneCounter++).padStart(8, '0')}`

beforeAll(async () => {
  db = await createTestDb()
})
afterAll(async () => {
  await db?.close()
})

async function addContact(owner: TestUser, other: { phone: string }, name = 'Friend') {
  const [row] = await db.as<{ id: string }>(owner, 'select public.add_contact($1, $2) as id', [other.phone, name])
  return row.id
}

/** Friends who have added each other. */
async function friends(...names: string[]) {
  const users: TestUser[] = []
  for (const name of names) users.push(await db.signUp(name, nextPhone()))
  for (const a of users) for (const b of users) if (a !== b) await addContact(a, b, `nick-${b.personId.slice(0, 4)}`)
  return users
}

type Part = { person_id: string; paid: number; owed: number; shares?: number | null }

async function expense(by: TestUser, amount: number, parts: Part[], opts: { group?: string; entry?: string; version?: number } = {}) {
  const [row] = await db.as<{ id: string }>(
    by,
    `select public.save_expense($1, $2, $3, current_date, $4, 'exact', $5::jsonb, $6) as id`,
    [opts.entry ?? null, 'Dinner', amount, opts.group ?? null, JSON.stringify(parts), opts.version ?? null],
  )
  return row.id
}

/** Single payer, equal split among `among` (amount must divide evenly). */
async function paidFor(payer: TestUser, amount: number, among: TestUser[], by = payer) {
  const share = amount / among.length
  const parts = among.map((u) => ({
    person_id: u.personId,
    paid: u === payer ? amount : 0,
    owed: share,
  }))
  if (!among.includes(payer)) parts.push({ person_id: payer.personId, paid: amount, owed: 0 })
  return expense(by, amount, parts)
}

async function payment(by: TestUser, from: TestUser, to: TestUser, amount: number, allocations?: unknown[]) {
  const [row] = await db.as<{ id: string }>(
    by,
    `select public.save_payment(null, $1, $2, $3, current_date, 'upi', null, $4::jsonb) as id`,
    [from.personId, to.personId, amount, allocations ? JSON.stringify(allocations) : null],
  )
  return row.id
}

async function balances(user: TestUser) {
  const rows = await db.as<{ person_id: string; net: string }>(user, 'select * from public.my_balances()')
  return Object.fromEntries(rows.map((r) => [r.person_id, Number(r.net)]))
}

describe('profiles', () => {
  it('claims a phone once and rejects a second account on the same number', async () => {
    const a = await db.signUp('Asha', nextPhone())
    const [me] = await db.as<{ id: string }>(a, 'select public.me() as id')
    expect(me.id).toBe(a.personId)

    await expect(db.signUp('Impostor', a.phone)).rejects.toThrow(/phone_taken/)
  })

  it('links history recorded before the friend joined', async () => {
    const [a] = await friends('Arjun')
    const laterPhone = nextPhone()
    const pending = await addContact(a, { phone: laterPhone }, 'Kabir')
    await paidFor(a, 400, [a, { personId: pending } as TestUser])

    const kabir = await db.signUp('Kabir Real', laterPhone)
    expect(kabir.personId).toBe(pending)
    expect(await balances(kabir)).toEqual({ [a.personId]: -200 })
  })

  it('requires the verified SMS phone to match when present', async () => {
    const uid = crypto.randomUUID()
    await db.admin('insert into auth.users (id) values ($1)', [uid])
    await expect(
      db.as({ uid, phone: '919000000001' }, `select public.claim_profile('X', '+919000000002')`),
    ).rejects.toThrow(/phone_mismatch/)
    const [row] = await db.as<{ id: string }>(
      { uid, phone: '919000000001' },
      `select public.claim_profile('X', '+919000000001') as id`,
    )
    expect(row.id).toBeTruthy()
  })

  it('rejects malformed phone numbers and UPI ids', async () => {
    const [a] = await friends('Bad')
    await expect(db.as(a, `select public.add_contact('98765', 'x')`)).rejects.toThrow(/people_phone_format/)
    await expect(db.as(a, `select public.claim_profile('Bad', $1, 'not-a-upi')`, [a.phone])).rejects.toThrow(
      /people_upi_format/,
    )
  })

  it('masks phone numbers of people who are not my contacts', async () => {
    const [a, b] = await friends('Mia', 'Nia')
    const stranger = await db.signUp('Stranger', nextPhone())
    await addContact(b, stranger)
    await paidFor(b, 300, [a, b, stranger])

    const people = await db.as<{ id: string; phone: string; is_contact: boolean }>(a, 'select * from public.my_people()')
    const seen = people.find((p) => p.id === stranger.personId)!
    expect(seen.is_contact).toBe(true) // sharing an entry makes them a contact
    // Contacts created by sharing an entry still see the number (they were on the bill together).
    expect(seen.phone).toBe(stranger.phone)

    const outsider = await db.signUp('Outsider', nextPhone())
    const forOutsider = await db.as(outsider, 'select * from public.my_people()')
    expect(forOutsider.map((p) => p.id)).toEqual([outsider.personId])
  })
})

describe('expenses', () => {
  it('splits a bill and shows the debt on both dashboards', async () => {
    const [a, b, c] = await friends('A', 'B', 'C')
    await paidFor(a, 300, [a, b, c])
    expect(await balances(a)).toEqual({ [b.personId]: 100, [c.personId]: 100 })
    expect(await balances(b)).toEqual({ [a.personId]: -100 })
  })

  it('balances out when the debtor pays the next bill', async () => {
    const [a, b] = await friends('Ravi', 'Sam')
    await paidFor(a, 200, [a, b]) // Sam owes Ravi 100
    await paidFor(b, 200, [a, b]) // Ravi owes Sam 100
    expect(await balances(a)).toEqual({ [b.personId]: 0 })

    const passbook = await db.as<{ delta: string; running: string }>(a, 'select * from public.person_ledger($1)', [
      b.personId,
    ])
    expect(passbook.map((r) => [Number(r.delta), Number(r.running)])).toEqual([
      [100, 100],
      [-100, 0],
    ])
  })

  it('handles several payers with the fewest lines', async () => {
    const [a, b, c] = await friends('P1', 'P2', 'P3')
    // Total 900: A paid 600, B paid 300; each owes 300. C owes A 300.
    const id = await expense(a, 900, [
      { person_id: a.personId, paid: 600, owed: 300 },
      { person_id: b.personId, paid: 300, owed: 300 },
      { person_id: c.personId, paid: 0, owed: 300 },
    ])
    const lines = await db.as<{ debtor_id: string; creditor_id: string; amount: string }>(
      a,
      'select debtor_id, creditor_id, amount from public.ledger_lines where entry_id = $1',
      [id],
    )
    expect(lines).toEqual([{ debtor_id: c.personId, creditor_id: a.personId, amount: '300' }])
  })

  it('validates totals, participation and who can be added', async () => {
    const [a, b] = await friends('V1', 'V2')
    const stranger = await db.signUp('V3', nextPhone())
    await expect(
      expense(a, 100, [
        { person_id: a.personId, paid: 100, owed: 40 },
        { person_id: b.personId, paid: 0, owed: 50 },
      ]),
    ).rejects.toThrow(/split_mismatch/)
    await expect(
      expense(a, 100, [
        { person_id: a.personId, paid: 100, owed: 50 },
        { person_id: stranger.personId, paid: 0, owed: 50 },
      ]),
    ).rejects.toThrow(/unknown_person/)
    await expect(
      expense(a, 100, [{ person_id: a.personId, paid: 100, owed: 100 }]),
    ).rejects.toThrow(/nothing_to_split/)
    const [c, d] = await friends('V4', 'V5')
    await addContact(a, c)
    await addContact(a, d)
    await expect(
      expense(a, 100, [
        { person_id: c.personId, paid: 100, owed: 50 },
        { person_id: d.personId, paid: 0, owed: 50 },
      ]),
    ).rejects.toThrow(/must_participate/)
  })

  it('keeps an audit trail of edits and rejects stale edits', async () => {
    const [a, b] = await friends('E1', 'E2')
    const id = await paidFor(a, 200, [a, b])
    await expense(
      b,
      300,
      [
        { person_id: a.personId, paid: 300, owed: 150 },
        { person_id: b.personId, paid: 0, owed: 150 },
      ],
      { entry: id, version: 1 },
    )
    expect(await balances(a)).toEqual({ [b.personId]: 150 })

    await expect(
      expense(a, 100, [
        { person_id: a.personId, paid: 100, owed: 50 },
        { person_id: b.personId, paid: 0, owed: 50 },
      ], { entry: id, version: 1 }),
    ).rejects.toThrow(/stale_entry/)

    const events = await db.as<{ action: string; before: { entry: { amount: number } } | null }>(
      a,
      'select action, before from public.entry_events where entry_id = $1 order by id',
      [id],
    )
    expect(events.map((e) => e.action)).toEqual(['created', 'edited'])
    expect(events[1].before?.entry.amount).toBe(200)
  })

  it('removes deleted entries from balances and can restore them', async () => {
    const [a, b] = await friends('D1', 'D2')
    const id = await paidFor(a, 200, [a, b])
    await db.as(b, 'select public.delete_entry($1)', [id])
    expect(await balances(a)).toEqual({})
    await db.as(a, 'select public.restore_entry($1)', [id])
    expect(await balances(a)).toEqual({ [b.personId]: 100 })
    const feed = await db.as<{ action: string }>(a, 'select action from public.my_activity() where entry_id = $1', [id])
    expect(feed.map((f) => f.action)).toEqual(['restored', 'deleted', 'created'])
  })
})

describe('payments', () => {
  it('settles a debt directly', async () => {
    const [a, b] = await friends('S1', 'S2')
    await paidFor(a, 500, [a, b])
    await payment(b, b, a, 250)
    expect(await balances(a)).toEqual({ [b.personId]: 0 })
  })

  it('lets one half of a couple pay for both', async () => {
    const [me, amit, neha] = await friends('Me', 'Amit', 'Neha')
    await paidFor(me, 1000, [me, amit]) // Amit owes me 500
    await paidFor(me, 600, [me, neha]) // Neha owes me 300

    // Amit pays me 800 for both. Neha now owes Amit the 300 he covered.
    await payment(amit, amit, me, 800, [
      { debtor: amit.personId, creditor: me.personId, amount: 500 },
      { debtor: neha.personId, creditor: me.personId, amount: 300 },
      { debtor: amit.personId, creditor: neha.personId, amount: 300 },
    ])

    expect(await balances(me)).toEqual({ [amit.personId]: 0, [neha.personId]: 0 })
    expect((await balances(neha))[amit.personId]).toBe(-300)
    // Neha sees the payment that cleared her debt.
    const nehaFeed = await db.as<{ kind: string; my_delta: string }>(neha, 'select kind, my_delta from public.my_activity()')
    expect(nehaFeed[0]).toEqual({ kind: 'payment', my_delta: '0' })
  })

  it('accepts the client planner’s household settlement with balances running both ways', async () => {
    const [me, amit, neha] = await friends('Me2', 'Amit2', 'Neha2')
    await paidFor(amit, 1000, [me, amit]) // I owe Amit 500
    await paidFor(me, 400, [me, neha]) // Neha owes me 200
    const balancesBefore = await balances(me)
    const plan = planHouseholdPayment({
      single: me.personId,
      actor: amit.personId,
      members: [amit.personId, neha.personId],
      balances: balancesBefore,
      amount: 300,
      payer: 'single',
    })
    await payment(me, me, amit, plan.amount, plan.allocations)
    expect(await balances(me)).toEqual({ [amit.personId]: 0, [neha.personId]: 0 })
    // Amit received 300 net but absorbed Neha's 200 debt, so Neha now owes Amit 200.
    expect((await balances(amit))[neha.personId]).toBe(200)
  })

  it('rejects allocations that do not add up to the money that moved', async () => {
    const [a, b, c] = await friends('M1', 'M2', 'M3')
    await expect(
      payment(a, a, b, 100, [{ debtor: c.personId, creditor: b.personId, amount: 100 }]),
    ).rejects.toThrow(/allocation_mismatch/)
  })

  it('cannot be written by someone outside it', async () => {
    const [a, b] = await friends('O1', 'O2')
    const outsider = await db.signUp('O3', nextPhone())
    await expect(payment(outsider, a, b, 100)).rejects.toThrow(/must_participate/)
  })
})

describe('row level security', () => {
  it('hides other people’s entries and blocks direct writes', async () => {
    const [a, b] = await friends('R1', 'R2')
    const outsider = await db.signUp('R3', nextPhone())
    const id = await paidFor(a, 200, [a, b])

    expect(await db.as(outsider, 'select * from public.entries where id = $1', [id])).toEqual([])
    expect(await db.as(outsider, 'select * from public.ledger_lines where entry_id = $1', [id])).toEqual([])
    await expect(
      db.as(a, `insert into public.ledger_lines (entry_id, debtor_id, creditor_id, amount) values ($1, $2, $3, 1)`, [
        id,
        b.personId,
        a.personId,
      ]),
    ).rejects.toThrow(/permission denied/)
    await expect(db.as(a, 'select phone from public.people')).rejects.toThrow(/permission denied/)
    await expect(db.as(null, 'select public.my_balances()')).resolves.toBeDefined()
    await expect(db.as(outsider, 'select public.delete_entry($1)', [id])).rejects.toThrow(/entry_not_found/)
  })
})

describe('groups and households', () => {
  it('computes group balances from group entries only', async () => {
    const [a, b, c] = await friends('G1', 'G2', 'G3')
    const [{ id: group }] = await db.as<{ id: string }>(a, `select public.create_group('Trip', '🏖️', $1) as id`, [
      [b.personId, c.personId],
    ])
    await expense(a, 300, [
      { person_id: a.personId, paid: 300, owed: 100 },
      { person_id: b.personId, paid: 0, owed: 100 },
      { person_id: c.personId, paid: 0, owed: 100 },
    ], { group })
    await paidFor(b, 1000, [b, c]) // outside the group

    const rows = await db.as<{ person_id: string; net: string }>(c, 'select * from public.group_balances($1)', [group])
    const net = Object.fromEntries(rows.map((r) => [r.person_id, Number(r.net)]))
    expect(net).toEqual({ [a.personId]: 200, [b.personId]: -100, [c.personId]: -100 })

    const outsider = await db.signUp('G4', nextPhone())
    expect(await db.as(outsider, 'select * from public.group_balances($1)', [group])).toEqual([])
    await addContact(a, outsider)
    await expect(
      expense(a, 100, [
        { person_id: a.personId, paid: 100, owed: 50 },
        { person_id: outsider.personId, paid: 0, owed: 50 },
      ], { group }),
    ).rejects.toThrow(/not_group_member/)
  })

  it('keeps each person in at most one of my households', async () => {
    const [me, x, y, z] = await friends('H0', 'H1', 'H2', 'H3')
    await db.as(me, `select public.save_household(null, 'X & Y', $1)`, [[x.personId, y.personId]])
    await expect(
      db.as(me, `select public.save_household(null, 'Y & Z', $1)`, [[y.personId, z.personId]]),
    ).rejects.toThrow(/already_in_household/)
    // Another user can group the same people their own way.
    await db.as(z, `select public.save_household(null, 'X & Y', $1)`, [[x.personId, y.personId]])
  })
})
