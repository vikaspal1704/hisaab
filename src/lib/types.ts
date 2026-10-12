import type { Paise } from './money'
import type { Allocation } from './settle'
import type { EntryPart, SplitMode } from './split'

export interface Person {
  id: string
  display_name: string
  phone: string
  upi_id: string | null
  is_registered: boolean
  is_contact: boolean
  is_me: boolean
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

export interface Group {
  id: string
  name: string
  emoji: string | null
  memberIds: string[]
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
  kind: 'expense' | 'payment'
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
  kind: 'expense' | 'payment'
  description: string
  amount: Paise
  occurred_on: string
  is_deleted: boolean
  my_delta: Paise
}

export interface EntryDetail {
  id: string
  kind: 'expense' | 'payment'
  description: string
  amount: Paise
  occurred_on: string
  group_id: string | null
  split_mode: SplitMode | null
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
}

export type PaymentMethod = 'cash' | 'upi' | 'bank' | 'other'
