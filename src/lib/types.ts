import type { Paise } from './money'
import type { Allocation } from './settle'
import type { Style } from './baari'
import type { CarpoolStyle } from './carpool'
import type { StoredItems } from './itemSplit'
import type { EntryPart, SplitMode, SplitUnit } from './split'

export type EntryKind = 'expense' | 'payment' | 'forgive' | 'treat'

export interface Person {
  id: string
  display_name: string
  /** null for a friend added by name only (see add_contact_by_name) */
  phone: string | null
  upi_id: string | null
  is_registered: boolean
  is_contact: boolean
  is_me: boolean
  /** a number-less friend I added, so I may give them a number */
  can_set_phone?: boolean
  /** their number was verified (OTP or WhatsApp) */
  phone_verified?: boolean
}

export interface Balance {
  person_id: string
  /** positive = they owe me */
  net: Paise
  last_activity: string
}

export interface Household {
  id: string
  name: string
  memberIds: string[]
}

export type GroupKind = 'friends' | 'trip' | 'home' | 'office' | 'carpool'

export interface Group {
  id: string
  name: string
  emoji: string | null
  memberIds: string[]
  kind: GroupKind
  tolerance: Paise
  kittyHolder: string | null
  /** who made the group (only they can delete it) */
  createdBy: string
  /** car pools: how trips are paid for, and the fare per rider or cost per trip */
  carpoolStyle: CarpoolStyle | null
  carpoolAmount: Paise | null
}

export interface ContactPrefs {
  person_id: string
  style: Style
  tolerance: Paise
  remind_above: Paise
  remind_after_days: number
  last_nudged_at: string | null
}

export interface ReviewRow {
  entry_id: string
  state: 'pending' | 'questioned'
  kind: EntryKind
  description: string
  amount: Paise
  occurred_on: string
  actor_id: string
  at: string
  my_delta: Paise
  questioned_by: string | null
  question_note: string | null
}

export interface Reaction {
  entry_id: string
  person_id: string
  status: 'confirmed' | 'questioned'
  note: string | null
}

export interface Shortcut {
  id: string
  label: string
  description: string
  amount: Paise | null
  group_id: string | null
  units: SplitUnit[]
}

export interface TreatSummary {
  i_gave: number
  i_gave_amount: Paise
  they_gave: number
  they_gave_amount: Paise
  last_giver: string | null
  last_on: string | null
}

export interface RecurringRule {
  id: string
  group_id: string
  description: string
  amount: Paise
  split_mode: SplitMode
  parts: EntryPart[]
  day_of_month: number
  frequency: 'monthly' | 'weekdays' | 'daily'
  next_on: string
  active: boolean
}

export interface SharedView {
  owner_name: string
  owner_upi: string | null
  friend_name: string
  friend_registered: boolean
  entries: {
    entry_id: string
    kind: EntryKind
    description: string
    occurred_on: string
    amount: Paise
    /** from the friend's point of view: positive = owner owes the friend */
    delta: Paise
    running: Paise
    reaction: Reaction['status'] | null
  }[]
}

export interface GroupBalance {
  person_id: string
  /** positive = is owed within the group */
  net: Paise
  paid_total: Paise
  owed_total: Paise
}

export interface LedgerRow {
  entry_id: string
  kind: EntryKind
  description: string
  occurred_on: string
  created_at: string
  amount: Paise
  method: string | null
  delta: Paise
  running: Paise
}

export interface ActivityRow {
  event_id: number
  action: 'created' | 'edited' | 'deleted' | 'restored'
  actor_id: string
  at: string
  entry_id: string
  kind: EntryKind
  description: string
  amount: Paise
  occurred_on: string
  is_deleted: boolean
  my_delta: Paise
}

export interface SearchRow {
  entry_id: string
  kind: EntryKind
  description: string
  amount: Paise
  occurred_on: string
  group_id: string | null
  my_delta: Paise
}

export interface EntryDetail {
  id: string
  kind: EntryKind
  occasion: string | null
  kitty: boolean
  description: string
  amount: Paise
  occurred_on: string
  group_id: string | null
  split_mode: SplitMode | null
  /** the bill, for expenses split by item */
  items: StoredItems | null
  method: string | null
  created_by: string
  created_at: string
  updated_at: string | null
  deleted_at: string | null
  version: number
  parts: EntryPart[]
  allocations: Allocation[]
  lines: { debtor_id: string; creditor_id: string; amount: Paise }[]
  events: { id: number; actor_id: string; action: ActivityRow['action']; created_at: string; before: unknown }[]
  reactions: Reaction[]
}

export type PaymentMethod = 'cash' | 'upi' | 'bank' | 'other'
