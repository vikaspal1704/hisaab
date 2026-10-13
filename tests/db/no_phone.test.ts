import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb, type TestUser } from './harness'

let db: TestDb
let phoneCounter = 0
const nextPhone = () => `+9193${String(10000000 + phoneCounter++).padStart(8, '0')}`

beforeAll(async () => {
  db = await createTestDb()
})
afterAll(async () => {
  await db?.close()
})

const addByName = async (by: TestUser, name: string) =>
  (await db.as<{ id: string }>(by, 'select public.add_contact_by_name($1) as id', [name]))[0].id
const addByPhone = async (by: TestUser, phone: string, name: string) =>
  (await db.as<{ id: string }>(by, 'select public.add_contact($1, $2) as id', [phone, name]))[0].id
const setPhone = async (by: TestUser, person: string, phone: string) =>
  (await db.as<{ id: string }>(by, 'select public.set_contact_phone($1, $2) as id', [person, phone]))[0].id

async function expense(by: TestUser, amount: number, parts: { person_id: string; paid: number; owed: number }[], group: string | null = null) {
  const [row] = await db.as<{ id: string }>(
    by,
    `select public.save_expense(null, 'Dinner', $1, current_date, $2, 'exact', $3::jsonb) as id`,
    [amount, group, JSON.stringify(parts)],
  )
  return row.id
}
const net = async (me: TestUser, other: string) =>
  Number((await db.as<{ net: string }>(me, 'select net from public.my_balances() where person_id = $1', [other]))[0]?.net ?? 0)

describe('friends without a number', () => {
  it('can be added by name, put on expenses, and show with no number', async () => {
    const me = await db.signUp('Asha', nextPhone())
    const cook = await addByName(me, ' Ramu kaka ')
    await expense(me, 30000, [
      { person_id: me.personId, paid: 30000, owed: 0 },
      { person_id: cook, paid: 0, owed: 30000 },
    ])
    expect(await net(me, cook)).toBe(30000)
    const [row] = await db.as(me, 'select display_name, phone, is_registered, is_contact from public.my_people() where id = $1', [cook])
    expect(row).toEqual({ display_name: 'Ramu kaka', phone: null, is_registered: false, is_contact: true })
    await expect(addByName(me, '  ')).rejects.toThrow(/invalid_name/)
    await expect(db.as(me, 'select public.add_contact(null, $1)', ['X'])).rejects.toThrow(/invalid_phone/)
    await expect(db.as(me, `select public.add_contacts('[{"name":"X"}]'::jsonb)`)).rejects.toThrow(/invalid_phone/)
  })

  it('gets a number later; only the person who added them can set it', async () => {
    const me = await db.signUp('Bina', nextPhone())
    const other = await db.signUp('Chetan', nextPhone())
    await addByPhone(me, other.phone, 'Chetan')
    await addByPhone(other, me.phone, 'Bina')
    const friend = await addByName(me, 'Dev')
    const [{ id: group }] = await db.as<{ id: string }>(me, `select public.create_group('Trip', null, $1) as id`, [[other.personId, friend]])
    await expect(setPhone(other, friend, nextPhone())).rejects.toThrow(/unknown_person/)
    await expect(setPhone(me, friend, '12345')).rejects.toThrow(/invalid_phone/)
    await expect(setPhone(me, friend, me.phone)).rejects.toThrow(/cannot_add_self/)

    const phone = nextPhone()
    expect(await setPhone(me, friend, phone)).toBe(friend)
    const [row] = await db.as(me, 'select phone from public.my_people() where id = $1', [friend])
    expect(row.phone).toBe(phone)
    // Once it has a number it's an ordinary friend; it can't be changed this way.
    await expect(setPhone(me, friend, nextPhone())).rejects.toThrow(/unknown_person/)
    expect(group).toBeTruthy()
  })

  it('merges into the person who already has that number, with all history', async () => {
    const me = await db.signUp('Esha', nextPhone())
    const flatmate = await db.signUp('Farhan', nextPhone())
    await addByPhone(me, flatmate.phone, 'Farhan')
    await addByPhone(flatmate, me.phone, 'Esha')
    const gauravPhone = nextPhone()
    // Farhan already keeps hisaab with Gaurav by number…
    const gauravByPhone = await addByPhone(flatmate, gauravPhone, 'Gaurav')
    await expense(flatmate, 10000, [
      { person_id: flatmate.personId, paid: 10000, owed: 0 },
      { person_id: gauravByPhone, paid: 0, owed: 10000 },
    ])
    // …while Esha only knows Gaurav's name, and has a group and an expense with him.
    const gaurav = await addByName(me, 'Gaurav bhai')
    const [{ id: group }] = await db.as<{ id: string }>(me, `select public.create_group('Flat', null, $1) as id`, [[flatmate.personId, gaurav]])
    await expense(me, 9000, [
      { person_id: me.personId, paid: 9000, owed: 3000 },
      { person_id: gaurav, paid: 0, owed: 3000 },
      { person_id: flatmate.personId, paid: 0, owed: 3000 },
    ], group)
    await db.as(me, `select public.save_household(null, 'Gang', $1)`, [[flatmate.personId, gaurav]])

    expect(await setPhone(me, gaurav, gauravPhone)).toBe(gauravByPhone)

    expect(await db.admin('select id from public.people where id = $1', [gaurav])).toEqual([])
    expect(await net(me, gauravByPhone)).toBe(3000)
    const [mine] = await db.as(me, 'select display_name, phone from public.my_people() where id = $1', [gauravByPhone])
    expect(mine).toEqual({ display_name: 'Gaurav bhai', phone: gauravPhone })
    const members = await db.as<{ person_id: string }>(me, 'select person_id from public.group_members where group_id = $1 order by person_id', [group])
    expect(members.map((m) => m.person_id).sort()).toEqual([me.personId, flatmate.personId, gauravByPhone].sort())
    const household = await db.as(me, 'select person_id from public.household_members where person_id = $1', [gauravByPhone])
    expect(household).toHaveLength(1)

    // When Gaurav signs up (OTP-verified number), he sees both histories.
    const uid = crypto.randomUUID()
    await db.admin('insert into auth.users (id) values ($1)', [uid])
    const [{ id }] = await db.as<{ id: string }>({ uid, phone: gauravPhone.slice(1) }, 'select public.claim_profile($1, $2) as id', ['Gaurav', gauravPhone])
    expect(id).toBe(gauravByPhone)
    const gauravUser = { uid, phone: gauravPhone, personId: id }
    expect(await net(gauravUser, me.personId)).toBe(-3000)
    expect(await net(gauravUser, flatmate.personId)).toBe(-10000)
  })

  it('refuses to merge two people who are on the same expense', async () => {
    const me = await db.signUp('Hina', nextPhone())
    const itsPhone = nextPhone()
    const byPhone = await addByPhone(me, itsPhone, 'Imran')
    const byName = await addByName(me, 'Imran (old)')
    await expense(me, 900, [
      { person_id: me.personId, paid: 900, owed: 300 },
      { person_id: byPhone, paid: 0, owed: 300 },
      { person_id: byName, paid: 0, owed: 300 },
    ])
    await expect(setPhone(me, byName, itsPhone)).rejects.toThrow(/merge_conflict/)
  })

  it('becomes whoever joins from the passbook link sent to them', async () => {
    const me = await db.signUp('Jaya', nextPhone())
    const friend = await addByName(me, 'Kabir')
    await expense(me, 5000, [
      { person_id: me.personId, paid: 5000, owed: 2500 },
      { person_id: friend, paid: 0, owed: 2500 },
    ])
    const [{ token }] = await db.as<{ token: string }>(me, 'select public.create_share_link($1) as token', [friend])

    const uid = crypto.randomUUID()
    await db.admin('insert into auth.users (id) values ($1)', [uid])
    const phone = nextPhone()
    const [{ id }] = await db.as<{ id: string }>({ uid }, 'select public.claim_profile($1, $2, null, $3) as id', ['Kabir', phone, token])
    expect(id).toBe(friend)
    expect(await net({ uid, phone, personId: id }, me.personId)).toBe(-2500)
    const [row] = await db.as(me, 'select phone, is_registered from public.my_people() where id = $1', [friend])
    expect(row).toEqual({ phone, is_registered: true })
  })

  it('never lets an account exist without a number', async () => {
    const uid = crypto.randomUUID()
    await db.admin('insert into auth.users (id) values ($1)', [uid])
    await expect(db.as({ uid }, 'select public.claim_profile($1, null)', ['Nobody'])).rejects.toThrow(/invalid_phone/)
    await expect(db.admin(`insert into public.people (name, user_id) values ('X', $1)`, [uid])).rejects.toThrow(/people_registered_has_phone/)
  })
})

describe('expenses logged for others', () => {
  it('records a debt between two friends; the logger sees it and can fix it', async () => {
    const me = await db.signUp('Lata', nextPhone())
    const rahul = await db.signUp('Rahul', nextPhone())
    const priya = await db.signUp('Priya', nextPhone())
    await addByPhone(me, rahul.phone, 'Rahul')
    await addByPhone(me, priya.phone, 'Priya')

    const entry = await expense(me, 50000, [
      { person_id: rahul.personId, paid: 50000, owed: 0 },
      { person_id: priya.personId, paid: 0, owed: 50000 },
    ])
    expect(await net(priya, rahul.personId)).toBe(-50000)
    expect(await net(me, rahul.personId)).toBe(0)
    // They can see who added it for them.
    const seen = await db.as<{ id: string }>(priya, 'select id from public.my_people()')
    expect(seen.map((r) => r.id)).toContain(me.personId)

    // I still see it: the entry, its parts, my activity, search.
    expect(await db.as(me, 'select id from public.entries where id = $1', [entry])).toHaveLength(1)
    expect(await db.as(me, 'select person_id from public.entry_parts where entry_id = $1', [entry])).toHaveLength(2)
    const activity = await db.as<{ entry_id: string; my_delta: string }>(me, 'select entry_id, my_delta from public.my_activity()')
    expect(activity).toContainEqual({ entry_id: entry, my_delta: '0' })
    expect((await db.as(me, `select entry_id from public.search_entries('Dinner')`)).map((r) => r.entry_id)).toContain(entry)

    // They see it to check; they and I can fix it.
    const reviews = await db.as<{ entry_id: string; state: string }>(priya, 'select entry_id, state from public.my_reviews()')
    expect(reviews).toContainEqual({ entry_id: entry, state: 'pending' })
    await db.as(me, `select public.save_expense($1, 'Dinner', 40000, current_date, null, 'exact', $2::jsonb, 1)`, [
      entry,
      JSON.stringify([
        { person_id: rahul.personId, paid: 40000, owed: 0 },
        { person_id: priya.personId, paid: 0, owed: 40000 },
      ]),
    ])
    expect(await net(priya, rahul.personId)).toBe(-40000)

    // If one of them questions it, I hear about it.
    await db.as(priya, `select public.react_to_entry($1, 'questioned', 'Was it 400?')`, [entry])
    const mine = await db.as<{ entry_id: string; state: string }>(me, 'select entry_id, state from public.my_reviews()')
    expect(mine).toContainEqual({ entry_id: entry, state: 'questioned' })

    await db.as(me, 'select public.delete_entry($1)', [entry])
    expect(await net(priya, rahul.personId)).toBe(0)
  })

  it('still only allows my friends or group members', async () => {
    const me = await db.signUp('Mona', nextPhone())
    const a = await db.signUp('Nikhil', nextPhone())
    const stranger = await db.signUp('Om', nextPhone())
    await addByPhone(me, a.phone, 'Nikhil')
    await expect(
      expense(me, 100, [
        { person_id: a.personId, paid: 100, owed: 50 },
        { person_id: stranger.personId, paid: 0, owed: 50 },
      ]),
    ).rejects.toThrow(/unknown_person/)
  })
})
