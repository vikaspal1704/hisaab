import type { Paise } from './money'
import type { Allocation } from './settle'
import type { EntryPart, SplitMode, SplitUnit } from './split'
import { supabase } from './supabase'
import type {
  ActivityRow,
  Balance,
  ContactPrefs,
  GroupKind,
  Reaction,
  RecurringRule,
  ReviewRow,
  SharedView,
  Shortcut,
  TreatSummary,
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

  /** Adds many friends at once; returns how many were new. */
  async addContacts(rows: { phone: string; name: string }[]): Promise<number> {
    let added = 0
    for (let i = 0; i < rows.length; i += 500) {
      added += await rpc<number>('add_contacts', { p_contacts: rows.slice(i, i + 500) })
    }
    return added
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
      .select('id, name, emoji, kind, tolerance, kitty_holder, group_members(person_id)')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data.map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      kind: g.kind,
      tolerance: num(g.tolerance),
      kittyHolder: g.kitty_holder,
      memberIds: g.group_members.map((m: { person_id: string }) => m.person_id),
    }))
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
         updated_at, deleted_at, version, occasion, kitty,
         reactions:entry_reactions(entry_id, person_id, status, note),
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
      reactions: d.reactions ?? [],
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

  async contactPrefs(): Promise<ContactPrefs[]> {
    const { data, error } = await supabase
      .from('contacts')
      .select('person_id, style, tolerance, remind_above, remind_after_days, last_nudged_at')
    if (error) throw error
    return data.map((c) => ({ ...c, tolerance: num(c.tolerance), remind_above: num(c.remind_above) })) as ContactPrefs[]
  },

  setContactPrefs(personId: string, prefs: Pick<ContactPrefs, 'style' | 'tolerance' | 'remind_above' | 'remind_after_days'>) {
    return rpc<void>('set_contact_prefs', {
      p_person: personId,
      p_style: prefs.style,
      p_tolerance: prefs.tolerance,
      p_remind_above: prefs.remind_above,
      p_remind_after_days: prefs.remind_after_days,
    })
  },

  markNudged(personId: string) {
    return rpc<void>('mark_nudged', { p_person: personId })
  },

  setGroupPrefs(groupId: string, kind: GroupKind, tolerance: Paise, kittyHolder: string | null) {
    return rpc<void>('set_group_prefs', { p_group: groupId, p_kind: kind, p_tolerance: tolerance, p_kitty_holder: kittyHolder })
  },

  forgive(personId: string, amount: Paise, note: string | null) {
    return rpc<string>('forgive_balance', { p_other: personId, p_amount: amount, p_note: note })
  },

  saveTreat(args: { giver: string; amount: Paise; description: string; occasion: string | null; occurredOn: string; guests: string[]; groupId: string | null }) {
    return rpc<string>('save_treat', {
      p_giver: args.giver,
      p_amount: args.amount,
      p_description: args.description,
      p_occasion: args.occasion,
      p_occurred_on: args.occurredOn,
      p_guests: args.guests,
      p_group: args.groupId,
    })
  },

  async treatSummary(personId: string): Promise<TreatSummary | null> {
    const rows = await rpc<TreatSummary[]>('treat_summary', { p_other: personId })
    const r = rows[0]
    if (!r) return null
    return { ...r, i_gave_amount: num(r.i_gave_amount), they_gave_amount: num(r.they_gave_amount) }
  },

  async shortcuts(): Promise<Shortcut[]> {
    const { data, error } = await supabase.from('shortcuts').select('id, label, description, amount, group_id, units').order('created_at')
    if (error) throw error
    return data.map((s) => ({ ...s, amount: s.amount == null ? null : num(s.amount) })) as Shortcut[]
  },

  saveShortcut(label: string, description: string, amount: Paise | null, groupId: string | null, units: SplitUnit[]) {
    return rpc<string>('save_shortcut', { p_label: label, p_description: description, p_amount: amount, p_group: groupId, p_units: units })
  },

  deleteShortcut(id: string) {
    return rpc<void>('delete_shortcut', { p_id: id })
  },

  react(entryId: string, status: Reaction['status'], note: string | null) {
    return rpc<void>('react_to_entry', { p_entry: entryId, p_status: status, p_note: note })
  },

  async reviews(): Promise<ReviewRow[]> {
    const rows = await rpc<ReviewRow[]>('my_reviews')
    return rows.map((r) => ({ ...r, amount: num(r.amount), my_delta: num(r.my_delta) }))
  },

  async reactionsFor(entryIds: string[]): Promise<Reaction[]> {
    if (entryIds.length === 0) return []
    const { data, error } = await supabase.from('entry_reactions').select('entry_id, person_id, status, note').in('entry_id', entryIds)
    if (error) throw error
    return data as Reaction[]
  },

  createShareLink(personId: string) {
    return rpc<string>('create_share_link', { p_person: personId })
  },

  async activeShareLink(personId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('share_links')
      .select('token')
      .eq('person_id', personId)
      .is('revoked_at', null)
      .maybeSingle()
    if (error) throw error
    return data?.token ?? null
  },

  revokeShareLink(personId: string) {
    return rpc<void>('revoke_share_link', { p_person: personId })
  },

  async sharedView(token: string): Promise<SharedView> {
    const view = await rpc<SharedView>('shared_view', { p_token: token })
    return {
      ...view,
      entries: view.entries.map((e) => ({ ...e, amount: num(e.amount), delta: num(e.delta), running: num(e.running) })),
    }
  },

  sharedReact(token: string, entryId: string, status: Reaction['status'], note: string | null) {
    return rpc<void>('shared_react', { p_token: token, p_entry: entryId, p_status: status, p_note: note })
  },

  addToKitty(groupId: string, from: string, amount: Paise, occurredOn: string, method: PaymentMethod) {
    return rpc<string>('add_to_kitty', { p_group: groupId, p_from: from, p_amount: amount, p_occurred_on: occurredOn, p_method: method })
  },

  saveKittyExpense(args: { description: string; amount: Paise; occurredOn: string; groupId: string; splitMode: SplitMode; parts: EntryPart[] }) {
    return rpc<string>('save_kitty_expense', {
      p_description: args.description,
      p_amount: args.amount,
      p_occurred_on: args.occurredOn,
      p_group: args.groupId,
      p_split_mode: args.splitMode,
      p_parts: args.parts,
    })
  },

  async groupKitty(groupId: string): Promise<{ holder_id: string | null; collected: Paise; spent: Paise } | null> {
    const rows = await rpc<{ holder_id: string | null; collected: Paise; spent: Paise }[]>('group_kitty', { p_group: groupId })
    const r = rows[0]
    return r ? { ...r, collected: num(r.collected), spent: num(r.spent) } : null
  },

  async recurring(groupId: string): Promise<RecurringRule[]> {
    const { data, error } = await supabase
      .from('recurring_rules')
      .select('id, group_id, description, amount, split_mode, parts, day_of_month, frequency, next_on, active')
      .eq('group_id', groupId)
      .eq('active', true)
      .order('day_of_month')
    if (error) throw error
    return data.map((r) => ({ ...r, amount: num(r.amount) })) as RecurringRule[]
  },

  saveRecurring(args: {
    groupId: string
    description: string
    amount: Paise
    splitMode: SplitMode
    parts: EntryPart[]
    dayOfMonth: number
    startOn: string
    frequency: RecurringRule['frequency']
  }) {
    return rpc<string>('save_recurring', {
      p_id: null,
      p_group: args.groupId,
      p_description: args.description,
      p_amount: args.amount,
      p_split_mode: args.splitMode,
      p_parts: args.parts,
      p_day_of_month: args.dayOfMonth,
      p_start_on: args.startOn,
      p_frequency: args.frequency,
    })
  },

  async kittySettlement(groupId: string): Promise<{ person_id: string; amount: Paise }[]> {
    const rows = await rpc<{ person_id: string; amount: Paise }[]>('kitty_settlement', { p_group: groupId })
    return rows.map((r) => ({ ...r, amount: num(r.amount) }))
  },

  closeKitty(groupId: string, method: PaymentMethod) {
    return rpc<number>('close_kitty', { p_group: groupId, p_method: method })
  },

  stopRecurring(id: string) {
    return rpc<void>('stop_recurring', { p_id: id })
  },

  runDueRecurring() {
    return rpc<number>('run_due_recurring')
  },

  savePushSubscription(endpoint: string, p256dh: string, auth: string) {
    return rpc<void>('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth })
  },

  deletePushSubscription(endpoint: string) {
    return rpc<void>('delete_push_subscription', { p_endpoint: endpoint })
  },

  deleteEntry(id: string) {
    return rpc<void>('delete_entry', { p_entry: id })
  },

  restoreEntry(id: string) {
    return rpc<void>('restore_entry', { p_entry: id })
  },
}
