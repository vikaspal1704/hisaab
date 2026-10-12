import type { Paise } from './money'
import type { Allocation } from './settle'
import type { EntryPart, SplitMode } from './split'
import { supabase } from './supabase'
import type {
  ActivityRow,
  Balance,
  EntryDetail,
  Group,
  GroupBalance,
  Household,
  LedgerRow,
  PaymentMethod,
  Person,
} from './types'

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

/** Postgres bigint arrives as a number for values this app can produce (≤ ₹1 crore). */
const num = (value: unknown) => Number(value ?? 0)

export const api = {
  async myPersonId(): Promise<string | null> {
    return rpc<string | null>('me')
  },

  claimProfile(name: string, phone: string, upiId: string | null) {
    return rpc<string>('claim_profile', { p_name: name, p_phone: phone, p_upi_id: upiId })
  },

  addContact(phone: string, name: string) {
    return rpc<string>('add_contact', { p_phone: phone, p_name: name })
  },

  setNickname(personId: string, nickname: string) {
    return rpc<void>('set_nickname', { p_person: personId, p_nickname: nickname })
  },

  people() {
    return rpc<Person[]>('my_people')
  },

  async balances(): Promise<Balance[]> {
    const rows = await rpc<Balance[]>('my_balances')
    return rows.map((r) => ({ ...r, net: num(r.net) }))
  },

  async personLedger(personId: string): Promise<LedgerRow[]> {
    const rows = await rpc<LedgerRow[]>('person_ledger', { p_other: personId })
    return rows.map((r) => ({ ...r, amount: num(r.amount), delta: num(r.delta), running: num(r.running) }))
  },

  async activity(limit = 50, before?: number): Promise<ActivityRow[]> {
    const rows = await rpc<ActivityRow[]>('my_activity', { p_limit: limit, p_before: before ?? null })
    return rows.map((r) => ({ ...r, amount: num(r.amount), my_delta: num(r.my_delta) }))
  },

  async households(): Promise<Household[]> {
    const { data, error } = await supabase
      .from('households')
      .select('id, name, household_members(person_id)')
      .order('created_at')
    if (error) throw error
    return data.map((h) => ({ id: h.id, name: h.name, memberIds: h.household_members.map((m) => m.person_id) }))
  },

  saveHousehold(id: string | null, name: string, memberIds: string[]) {
    return rpc<string>('save_household', { p_id: id, p_name: name, p_members: memberIds })
  },

  deleteHousehold(id: string) {
    return rpc<void>('delete_household', { p_id: id })
  },

  async groups(): Promise<Group[]> {
    const { data, error } = await supabase
      .from('groups')
      .select('id, name, emoji, group_members(person_id)')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data.map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, memberIds: g.group_members.map((m) => m.person_id) }))
  },

  createGroup(name: string, emoji: string | null, memberIds: string[]) {
    return rpc<string>('create_group', { p_name: name, p_emoji: emoji, p_members: memberIds })
  },

  updateGroup(id: string, name: string, emoji: string | null, addMemberIds: string[]) {
    return rpc<void>('update_group', { p_group: id, p_name: name, p_emoji: emoji, p_add_members: addMemberIds })
  },

  async groupBalances(groupId: string): Promise<GroupBalance[]> {
    const rows = await rpc<GroupBalance[]>('group_balances', { p_group: groupId })
    return rows.map((r) => ({ ...r, net: num(r.net), paid_total: num(r.paid_total), owed_total: num(r.owed_total) }))
  },

  async entry(id: string): Promise<EntryDetail | null> {
    const { data, error } = await supabase
      .from('entries')
      .select(
        `id, kind, description, amount, occurred_on, group_id, split_mode, method, created_by, created_at,
         updated_at, deleted_at, version,
         parts:entry_parts(person_id, paid, owed, shares),
         allocations:entry_allocations(debtor:debtor_id, creditor:creditor_id, amount),
         lines:ledger_lines(debtor_id, creditor_id, amount),
         events:entry_events(id, actor_id, action, created_at, before)`,
      )
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const d = data as unknown as EntryDetail
    return {
      ...d,
      amount: num(d.amount),
      parts: d.parts.map((p) => ({ ...p, paid: num(p.paid), owed: num(p.owed), shares: p.shares == null ? null : num(p.shares) })),
      allocations: d.allocations.map((a) => ({ ...a, amount: num(a.amount) })),
      lines: d.lines.map((l) => ({ ...l, amount: num(l.amount) })),
      events: [...d.events].sort((a, b) => a.id - b.id),
    }
  },

  saveExpense(args: {
    entryId: string | null
    description: string
    amount: Paise
    occurredOn: string
    groupId: string | null
    splitMode: SplitMode
    parts: EntryPart[]
    expectedVersion: number | null
  }) {
    return rpc<string>('save_expense', {
      p_entry: args.entryId,
      p_description: args.description,
      p_amount: args.amount,
      p_occurred_on: args.occurredOn,
      p_group: args.groupId,
      p_split_mode: args.splitMode,
      p_parts: args.parts,
      p_expected_version: args.expectedVersion,
    })
  },

  savePayment(args: {
    entryId: string | null
    from: string
    to: string
    amount: Paise
    occurredOn: string
    method: PaymentMethod
    note: string | null
    allocations: Allocation[] | null
    groupId: string | null
    expectedVersion: number | null
  }) {
    return rpc<string>('save_payment', {
      p_entry: args.entryId,
      p_from: args.from,
      p_to: args.to,
      p_amount: args.amount,
      p_occurred_on: args.occurredOn,
      p_method: args.method,
      p_note: args.note,
      p_allocations: args.allocations,
      p_group: args.groupId,
      p_expected_version: args.expectedVersion,
    })
  },

  deleteEntry(id: string) {
    return rpc<void>('delete_entry', { p_entry: id })
  },

  restoreEntry(id: string) {
    return rpc<void>('restore_entry', { p_entry: id })
  },
}
