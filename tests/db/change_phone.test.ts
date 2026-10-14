import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb, type TestUser } from './harness'

let db: TestDb
let phoneCounter = 0
const nextPhone = () => `+9192${String(10000000 + phoneCounter++).padStart(8, '0')}`

beforeAll(async () => {
  db = await createTestDb()
})
afterAll(async () => {
  await db?.close()
})

const addByPhone = async (by: TestUser, phone: string, name: string) =>
  (await db.as<{ id: string }>(by, 'select public.add_contact($1, $2) as id', [phone, name]))[0].id
const fix = async (by: TestUser, person: string, phone: string) =>
  (await db.as<{ id: string }>(by, 'select public.fix_contact_phone($1, $2) as id', [person, phone]))[0].id
async function owes(by: TestUser, debtor: string, amount: number, group: string | null = null) {
  await db.as(by, `select public.save_expense(null, 'Chai', $1, current_date, $2, 'exact', $3::jsonb)`, [
    amount,
    group,
    JSON.stringify([
      { person_id: by.personId, paid: amount, owed: 0 },
      { person_id: debtor, paid: 0, owed: amount },
    ]),
  ])
}
const net = async (me: TestUser, other: string) =>
  Number((await db.as<{ net: string }>(me, 'select net from public.my_balances() where person_id = $1', [other]))[0]?.net ?? 0)
/** A WhatsApp message arriving at the webhook, as the Edge Function reports it. */
const whatsapp = async (code: string, from: string) =>
  (await db.asRole<{ ok: boolean }>('service_role', 'select public.confirm_whatsapp_verification($1, $2) as ok', [code, from]))[0].ok
const startVerification = async (user: { uid: string }, phone: string) =>
  (await db.as<{ code: string }>(user, 'select public.start_phone_verification($1) as code', [phone]))[0].code

describe('fixing a friend’s wrong number', () => {
  it('moves the history to the right number and turns off links sent to the wrong one', async () => {
    const me = await db.signUp('Aarav', nextPhone())
    const wrong = await addByPhone(me, nextPhone(), 'Bela')
    await owes(me, wrong, 5000)
    const [{ token }] = await db.as<{ token: string }>(me, 'select public.create_share_link($1) as token', [wrong])

    const right = nextPhone()
    expect(await fix(me, wrong, right)).toBe(wrong)
    const [row] = await db.as(me, 'select phone from public.my_people() where id = $1', [wrong])
    expect(row.phone).toBe(right)
    expect(await net(me, wrong)).toBe(5000)
    const links = await db.admin<{ revoked_at: string | null }>('select revoked_at from public.share_links where token = $1', [token])
    expect(links[0].revoked_at).not.toBeNull()
    await expect(fix(me, wrong, '12')).rejects.toThrow(/invalid_phone/)
    await expect(fix(me, wrong, me.phone)).rejects.toThrow(/cannot_add_self/)
  })

  it('joins up with whoever already has the right number', async () => {
    const me = await db.signUp('Chirag', nextPhone())
    const real = await db.signUp('Diya', nextPhone())
    const mistake = await addByPhone(me, nextPhone(), 'Diya')
    await owes(me, mistake, 3000)
    expect(await fix(me, mistake, real.phone)).toBe(real.personId)
    expect(await net(me, real.personId)).toBe(3000)
    expect(await net(real, me.personId)).toBe(-3000)
    expect(await db.admin('select id from public.people where id = $1', [mistake])).toEqual([])
  })

  it('is refused once they joined, or when someone else uses that number on their own', async () => {
    const me = await db.signUp('Esha', nextPhone())
    const joined = await db.signUp('Farah', nextPhone())
    await addByPhone(me, joined.phone, 'Farah')
    await expect(fix(me, joined.personId, nextPhone())).rejects.toThrow(/already_joined/)

    const other = await db.signUp('Gopal', nextPhone())
    const sharedPhone = nextPhone()
    const shared = await addByPhone(me, sharedPhone, 'Hari')
    await addByPhone(other, sharedPhone, 'Hari bhai')
    await expect(fix(me, shared, nextPhone())).rejects.toThrow(/number_shared/)

    const stranger = await db.signUp('Ira', nextPhone())
    await expect(fix(stranger, shared, nextPhone())).rejects.toThrow(/unknown_person/)
  })

  it('is fine when the others only know them through my own expenses and groups', async () => {
    const me = await db.signUp('Jai', nextPhone())
    const friend = await db.signUp('Kiran', nextPhone())
    await addByPhone(me, friend.phone, 'Kiran')
    const wrong = await addByPhone(me, nextPhone(), 'Lata')
    const [{ id: group }] = await db.as<{ id: string }>(me, `select public.create_group('Trip', null, $1) as id`, [[friend.personId, wrong]])
    await db.as(me, `select public.save_expense(null, 'Dinner', 9000, current_date, $1, 'equal', $2::jsonb)`, [
      group,
      JSON.stringify([
        { person_id: me.personId, paid: 9000, owed: 3000 },
        { person_id: friend.personId, paid: 0, owed: 3000 },
        { person_id: wrong, paid: 0, owed: 3000 },
      ]),
    ])
    const right = nextPhone()
    await fix(me, wrong, right)
    const [row] = await db.as(friend, 'select phone from public.my_people() where id = $1', [wrong])
    expect(row.phone).toMatch(new RegExp(`${right.slice(-3)}$`)) // masked for Kiran, but the new number
  })
})

describe('verifying a number on WhatsApp', () => {
  it('confirms a code only from the number it was issued for, before it expires', async () => {
    const me = await db.signUp('Manav', nextPhone())
    const newPhone = nextPhone()
    const code = await startVerification(me, newPhone)
    expect(code).toMatch(/^HSB-[2-9A-HJ-NP-Z]{8}$/)
    expect((await db.as(me, 'select public.phone_verification_status($1) as ok', [newPhone]))[0].ok).toBe(false)

    expect(await whatsapp(code, '919999999999')).toBe(false) // someone else's WhatsApp
    expect(await whatsapp(code.toLowerCase(), newPhone.slice(1))).toBe(true) // WhatsApp sends digits only
    expect(await whatsapp(code, newPhone.slice(1))).toBe(false) // only once
    expect((await db.as(me, 'select public.phone_verification_status($1) as ok', [newPhone]))[0].ok).toBe(true)

    const late = await startVerification(me, newPhone)
    await db.admin(`update public.phone_verifications set expires_at = now() - interval '1 minute' where code = $1`, [late])
    expect(await whatsapp(late, newPhone.slice(1))).toBe(false)
  })

  it('keeps codes away from clients', async () => {
    const me = await db.signUp('Nisha', nextPhone())
    await startVerification(me, nextPhone())
    await expect(db.as(me, 'select * from public.phone_verifications')).rejects.toThrow(/permission denied/)
    await expect(db.as(me, `select public.confirm_whatsapp_verification('HSB-AAAAAAAA', '919000000000')`)).rejects.toThrow(/permission denied/)
  })

  it('limits codes to 10 a day', async () => {
    const me = await db.signUp('Om', nextPhone())
    for (let i = 0; i < 10; i++) await startVerification(me, me.phone)
    await expect(startVerification(me, me.phone)).rejects.toThrow(/too_many_verifications/)
  })

  it('lets a Google sign-up take a number that already has history', async () => {
    const friend = await db.signUp('Pooja', nextPhone())
    const phone = nextPhone()
    const waiting = await addByPhone(friend, phone, 'Quasim')
    await owes(friend, waiting, 7000)

    const uid = randomUUID()
    await db.admin('insert into auth.users (id) values ($1)', [uid])
    await expect(db.as({ uid }, 'select public.claim_profile($1, $2)', ['Quasim', phone])).rejects.toThrow(/phone_needs_invite/)
    const code = await startVerification({ uid }, phone)
    await whatsapp(code, phone.slice(1))
    const [{ id }] = await db.as<{ id: string }>({ uid }, 'select public.claim_profile($1, $2) as id', ['Quasim', phone])
    expect(id).toBe(waiting)
    const [me] = await db.as({ uid }, 'select phone_verified from public.my_people() where is_me')
    expect(me.phone_verified).toBe(true)
  })
})

describe('changing my own number', () => {
  it('to a fresh number: just changes it', async () => {
    const me = await db.signUp('Rhea', nextPhone())
    const friend = await db.signUp('Sahil', nextPhone())
    await addByPhone(friend, me.phone, 'Rhea')
    const newPhone = nextPhone()
    await db.as(me, 'select public.change_my_phone($1)', [newPhone])
    const [row] = await db.as(friend, 'select phone, phone_verified from public.my_people() where id = $1', [me.personId])
    expect(row).toEqual({ phone: newPhone, phone_verified: false })
    // The old number is free again.
    const someone = await db.signUp('Tara', me.phone)
    expect(someone.personId).not.toBe(me.personId)
  })

  it('to a number with history: needs WhatsApp verification, then the history joins mine', async () => {
    const me = await db.signUp('Uday', nextPhone())
    const friend = await db.signUp('Vani', nextPhone())
    await addByPhone(friend, me.phone, 'Uday (old no.)')
    await owes(friend, me.personId, 1000)
    const rightPhone = nextPhone()
    const waiting = await addByPhone(friend, rightPhone, 'Uday')
    await owes(friend, waiting, 4000)

    await expect(db.as(me, 'select public.change_my_phone($1)', [rightPhone])).rejects.toThrow(/phone_needs_invite/)
    await whatsapp(await startVerification(me, rightPhone), rightPhone.slice(1))
    await db.as(me, 'select public.change_my_phone($1)', [rightPhone])

    expect(await net(me, friend.personId)).toBe(-5000)
    const [row] = await db.as(me, 'select phone, phone_verified from public.my_people() where is_me')
    expect(row).toEqual({ phone: rightPhone, phone_verified: true })
    expect(await db.admin('select id from public.people where id = $1', [waiting])).toEqual([])
  })

  it('never to a number someone has signed up with', async () => {
    const me = await db.signUp('Waseem', nextPhone())
    const other = await db.signUp('Yamini', nextPhone())
    await whatsapp(await startVerification(me, other.phone), other.phone.slice(1))
    await expect(db.as(me, 'select public.change_my_phone($1)', [other.phone])).rejects.toThrow(/phone_taken/)
  })
})
