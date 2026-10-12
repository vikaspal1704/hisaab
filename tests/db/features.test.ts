import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb, type TestUser } from './harness'

let db: TestDb
let phoneCounter = 0
const nextPhone = () => `+9197${String(10000000 + phoneCounter++).padStart(8, '0')}`

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

async function paidFor(payer: TestUser, amount: number, among: TestUser[], group: string | null = null) {
  const share = amount / among.length
  const parts = among.map((u) => ({ person_id: u.personId, paid: u === payer ? amount : 0, owed: share }))
  const [row] = await db.as<{ id: string }>(
    payer,
    `select public.save_expense(null, 'Chai', $1, current_date, $2, 'equal', $3::jsonb) as id`,
    [amount, group, JSON.stringify(parts)],
  )
  return row.id
}

async function net(user: TestUser, other: TestUser) {
  const rows = await db.as<{ net: string }>(user, 'select net from public.my_balances() where person_id = $1', [other.personId])
  return Number(rows[0]?.net ?? 0)
}

async function makeGroup(owner: TestUser, members: TestUser[]) {
  const [{ id }] = await db.as<{ id: string }>(owner, `select public.create_group('Trip', null, $1) as id`, [
    members.map((m) => m.personId),
  ])
  return id
}

describe('contact and group preferences', () => {
  it('defaults new friends to baari with a ₹100 tolerance and lets me change it', async () => {
    const [a, b] = await friends('Pa', 'Pb')
    const [c] = await db.as<{ style: string; tolerance: string }>(a, 'select style, tolerance from public.contacts where person_id = $1', [b.personId])
    expect(c).toEqual({ style: 'baari', tolerance: '10000' })
    await db.as(a, `select public.set_contact_prefs($1, 'exact', 0, 100000, 30)`, [b.personId])
    const [after] = await db.as<{ style: string }>(a, 'select style from public.contacts where person_id = $1', [b.personId])
    expect(after.style).toBe('exact')
    await expect(db.as(a, `select public.set_contact_prefs($1, 'weird', 0, 0, 1)`, [b.personId])).rejects.toThrow(/contacts_style/)
  })

  it('only lets group members be the kitty holder', async () => {
    const [a, b] = await friends('Ka', 'Kb')
    const outsider = await db.signUp('Kc', nextPhone())
    const group = await makeGroup(a, [b])
    await db.as(a, `select public.set_group_prefs($1, 'trip', 0, $2)`, [group, b.personId])
    await expect(db.as(a, `select public.set_group_prefs($1, 'trip', 0, $2)`, [group, outsider.personId])).rejects.toThrow(
      /not_group_member/,
    )
  })
})

describe('chhod do', () => {
  it('lets the person who is owed forgive up to what is owed', async () => {
    const [a, b] = await friends('Fa', 'Fb')
    await paidFor(a, 7400, [a, b]) // b owes a ₹37
    await expect(db.as(b, 'select public.forgive_balance($1, 3700)', [a.personId])).rejects.toThrow(/forgive_too_much/)
    await expect(db.as(a, 'select public.forgive_balance($1, 3800)', [b.personId])).rejects.toThrow(/forgive_too_much/)
    await db.as(a, 'select public.forgive_balance($1, 3700)', [b.personId])
    expect(await net(a, b)).toBe(0)
    const passbook = await db.as<{ kind: string }>(b, 'select kind from public.person_ledger($1)', [a.personId])
    expect(passbook.map((r) => r.kind)).toEqual(['expense', 'forgive'])
  })
})

describe('treats', () => {
  it('records treats without creating debt and counts who gave', async () => {
    const [a, b, c] = await friends('Ta', 'Tb', 'Tc')
    await db.as(a, `select public.save_treat($1, 340000, 'Birthday dinner', 'Birthday', current_date, $2)`, [
      a.personId,
      [b.personId, c.personId],
    ])
    await db.as(b, `select public.save_treat($1, 120000, 'Promotion party', 'Promotion', current_date, $2)`, [
      b.personId,
      [a.personId],
    ])
    expect(await net(a, b)).toBe(0)
    const [summary] = await db.as<Record<string, unknown>>(a, 'select * from public.treat_summary($1)', [b.personId])
    expect(summary).toMatchObject({ i_gave: 1, i_gave_amount: '340000', they_gave: 1, they_gave_amount: '120000', last_giver: b.personId })
  })
})

describe('reviews', () => {
  it('asks others to confirm what I added, resets on edit, and surfaces questions', async () => {
    const [a, b] = await friends('Ra', 'Rb')
    const id = await paidFor(a, 20000, [a, b])
    expect(await db.as(a, 'select * from public.my_reviews()')).toEqual([])
    const pending = await db.as<{ entry_id: string; state: string }>(b, 'select entry_id, state from public.my_reviews()')
    expect(pending).toEqual([{ entry_id: id, state: 'pending' }])

    await db.as(b, `select public.react_to_entry($1, 'confirmed')`, [id])
    expect(await db.as(b, 'select * from public.my_reviews()')).toEqual([])

    await db.as(a, `select public.save_expense($1, 'Chai', 30000, current_date, null, 'equal', $2::jsonb)`, [
      id,
      JSON.stringify([
        { person_id: a.personId, paid: 30000, owed: 15000 },
        { person_id: b.personId, paid: 0, owed: 15000 },
      ]),
    ])
    expect((await db.as(b, 'select state from public.my_reviews()')).map((r) => r.state)).toEqual(['pending'])

    await db.as(b, `select public.react_to_entry($1, 'questioned', 'I only had one chai')`, [id])
    const forA = await db.as<{ state: string; question_note: string }>(a, 'select state, question_note from public.my_reviews()')
    expect(forA).toEqual([{ state: 'questioned', question_note: 'I only had one chai' }])

    const outsider = await db.signUp('Rc', nextPhone())
    await expect(db.as(outsider, `select public.react_to_entry($1, 'confirmed')`, [id])).rejects.toThrow(/entry_not_found/)
  })
})

describe('share links', () => {
  it('shows a friend our passbook without an account and records their reaction', async () => {
    const [a] = await friends('Sa')
    const friendPhone = nextPhone()
    const [{ id: friendId }] = await db.as<{ id: string }>(a, `select public.add_contact($1, 'Kabir') as id`, [friendPhone])
    const friend = { personId: friendId } as TestUser
    const entry = await paidFor(a, 60000, [a, friend])

    const [{ token }] = await db.as<{ token: string }>(a, 'select public.create_share_link($1) as token', [friendId])
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const [{ token: again }] = await db.as<{ token: string }>(a, 'select public.create_share_link($1) as token', [friendId])
    expect(again).toBe(token)

    const asAnon = <T extends object>(sql: string, params: unknown[]) =>
      db.asRole<T & import('pg').QueryResultRow>('anon', sql, params)
    const [{ view }] = await asAnon<{ view: { owner_name: string; entries: { delta: number; reaction: string | null }[] } }>(
      'select public.shared_view($1) as view',
      [token],
    )
    expect(view.owner_name).toBe('Sa')
    expect(view.entries).toHaveLength(1)
    expect(view.entries[0]).toMatchObject({ delta: -30000, reaction: null })

    await asAnon('select public.shared_react($1, $2, $3)', [token, entry, 'confirmed'])
    const [{ view: after }] = await asAnon<{ view: { entries: { reaction: string }[] } }>('select public.shared_view($1) as view', [token])
    expect(after.entries[0].reaction).toBe('confirmed')

    // Entries the friend is not part of are off limits.
    const [b] = await friends('Sb')
    await db.as(a, 'select public.add_contact($1, $2)', [b.phone, 'Sb'])
    const other = await paidFor(a, 1000, [a, b])
    await expect(asAnon('select public.shared_react($1, $2, $3)', [token, other, 'questioned'])).rejects.toThrow(/entry_not_found/)

    await db.as(a, 'select public.revoke_share_link($1)', [friendId])
    await expect(asAnon('select public.shared_view($1)', [token])).rejects.toThrow(/link_not_found/)
    await expect(asAnon('select public.my_balances()', [])).rejects.toThrow(/permission denied/)
    await expect(asAnon('select * from public.entries', [])).rejects.toThrow(/permission denied/)
  })
})

describe('trip kitty', () => {
  it('tracks contributions and spends through the holder', async () => {
    const [a, b, c] = await friends('Ja', 'Jb', 'Jc')
    const group = await makeGroup(a, [b, c])
    await expect(db.as(a, `select public.add_to_kitty($1, $2, 200000, current_date, 'upi')`, [group, b.personId])).rejects.toThrow(/no_kitty/)
    await db.as(a, `select public.set_group_prefs($1, 'trip', 0, $2)`, [group, a.personId])

    await db.as(a, `select public.add_to_kitty($1, $2, 200000, current_date, 'upi')`, [group, b.personId])
    await db.as(c, `select public.add_to_kitty($1, $2, 200000, current_date, 'cash')`, [group, c.personId])
    await expect(db.as(a, `select public.add_to_kitty($1, $2, 1000, current_date, 'cash')`, [group, a.personId])).rejects.toThrow(
      /holder_cannot_contribute/,
    )

    const parts = [a, b, c].map((u) => ({ person_id: u.personId, paid: u === a ? 300000 : 0, owed: 100000 }))
    await db.as(b, `select public.save_kitty_expense('Houseboat', 300000, current_date, $1, 'equal', $2::jsonb)`, [
      group,
      JSON.stringify(parts),
    ])
    const wrongPayer = [a, b, c].map((u) => ({ person_id: u.personId, paid: u === b ? 3000 : 0, owed: 1000 }))
    await expect(
      db.as(b, `select public.save_kitty_expense('X', 3000, current_date, $1, 'equal', $2::jsonb)`, [group, JSON.stringify(wrongPayer)]),
    ).rejects.toThrow(/kitty_payer/)

    const [kitty] = await db.as<{ collected: string; spent: string }>(b, 'select collected, spent from public.group_kitty($1)', [group])
    expect(kitty).toMatchObject({ collected: '400000', spent: '300000' })
    // b put in 2000 and used 1000: the holder owes b 1000 back.
    expect(await net(b, a)).toBe(100000)
  })
})

describe('recurring', () => {
  it('posts each due month once, even if two phones run it', async () => {
    const [a, b] = await friends('Ma', 'Mb')
    const group = await makeGroup(a, [b])
    const parts = [
      { person_id: a.personId, paid: 2000000, owed: 1000000 },
      { person_id: b.personId, paid: 0, owed: 1000000 },
    ]
    // Started three months ago on the 1st: three rents are due.
    await db.as(a, `select public.save_recurring(null, $1, 'Rent', 2000000, 'equal', $2::jsonb, 1, (date_trunc('month', current_date) - interval '2 months')::date)`, [
      group,
      JSON.stringify(parts),
    ])
    const [{ n }] = await db.as<{ n: number }>(b, 'select public.run_due_recurring() as n')
    expect(n).toBe(3)
    const [{ again }] = await db.as<{ again: number }>(a, 'select public.run_due_recurring() as again')
    expect(again).toBe(0)
    expect(await net(a, b)).toBe(3000000)

    const [rule] = await db.as<{ next_on: Date }>(a, 'select next_on from public.recurring_rules')
    expect(rule.next_on.getTime()).toBeGreaterThan(Date.now() - 86400000)

    const outsider = await db.signUp('Mc', nextPhone())
    await expect(
      db.as(outsider, `select public.save_recurring(null, $1, 'Rent', 1, 'equal', '[]', 1, current_date)`, [group]),
    ).rejects.toThrow(/group_not_found/)
  })
})

describe('shortcuts and push subscriptions', () => {
  it('are private to their owner', async () => {
    const [a, b] = await friends('Xa', 'Xb')
    await db.as(a, `select public.save_shortcut('Chai', '☕ Chai', 4000, null, $1::jsonb)`, [
      JSON.stringify([{ key: b.personId, repId: b.personId, memberIds: [b.personId] }]),
    ])
    await db.as(a, `select public.save_push_subscription('https://push.example/1', 'k', 'a')`)
    expect(await db.as(a, 'select label from public.shortcuts')).toEqual([{ label: 'Chai' }])
    expect(await db.as(b, 'select label from public.shortcuts')).toEqual([])
    expect(await db.as(b, 'select endpoint from public.push_subscriptions')).toEqual([])
  })
})

describe('push targets', () => {
  it('lists everyone on an entry except the actor, with their own effect, for the service role only', async () => {
    const [a, b, c] = await friends('Na', 'Nb', 'Nc')
    await db.as(b, `select public.save_push_subscription('https://push.example/b', 'kb', 'ab')`)
    await db.as(a, `select public.save_push_subscription('https://push.example/a', 'ka', 'aa')`)
    const entry = await paidFor(a, 30000, [a, b, c])
    const [{ id: eventId }] = await db.admin<{ id: string }>('select id from public.entry_events where entry_id = $1', [entry])

    const targets = await db.asRole<{ endpoint: string; my_delta: string; actor_name: string }>(
      'service_role',
      'select endpoint, my_delta, actor_name from public.push_targets($1)',
      [eventId],
    )
    expect(targets).toEqual([{ endpoint: 'https://push.example/b', my_delta: '-10000', actor_name: 'x' }])
    await expect(db.as(a, 'select * from public.push_targets($1)', [eventId])).rejects.toThrow(/permission denied/)

    const digest = await db.asRole<{ endpoint: string; owed_to_me: string; i_owe: string }>(
      'service_role',
      `select endpoint, owed_to_me, i_owe from public.digest_targets() where endpoint like 'https://push.example/%' order by endpoint`,
      [],
    )
    expect(digest).toContainEqual({ endpoint: 'https://push.example/a', owed_to_me: '20000', i_owe: '0' })
  })
})
