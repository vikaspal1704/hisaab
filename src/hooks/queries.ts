import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../lib/api'
import type { Paise } from '../lib/money'
import type { Balance, ContactPrefs, Household, Person } from '../lib/types'

export const keys = {
  me: ['me'] as const,
  people: ['people'] as const,
  balances: ['balances'] as const,
  households: ['households'] as const,
  groups: ['groups'] as const,
  groupBalances: (id: string) => ['group-balances', id] as const,
  groupEntries: (id: string) => ['group-entries', id] as const,
  ledger: (id: string) => ['ledger', id] as const,
  activity: ['activity'] as const,
  entry: (id: string) => ['entry', id] as const,
  contactPrefs: ['contact-prefs'] as const,
  reviews: ['reviews'] as const,
  shortcuts: ['shortcuts'] as const,
  treats: (id: string) => ['treats', id] as const,
  shareLink: (id: string) => ['share-link', id] as const,
  kitty: (id: string) => ['kitty', id] as const,
  recurring: (id: string) => ['recurring', id] as const,
  reactions: (ids: string[]) => ['reactions', ...ids] as const,
}

export const useMyPersonId = (enabled = true) => useQuery({ queryKey: keys.me, queryFn: api.myPersonId, enabled })
export const usePeopleList = () => useQuery({ queryKey: keys.people, queryFn: api.people })
export const useBalanceList = () => useQuery({ queryKey: keys.balances, queryFn: api.balances })
export const useHouseholds = () => useQuery({ queryKey: keys.households, queryFn: api.households })
export const useGroups = () => useQuery({ queryKey: keys.groups, queryFn: api.groups })
export const useGroupBalances = (id: string) =>
  useQuery({ queryKey: keys.groupBalances(id), queryFn: () => api.groupBalances(id) })
export const usePersonLedger = (id: string) => useQuery({ queryKey: keys.ledger(id), queryFn: () => api.personLedger(id) })
export const useActivity = () => useQuery({ queryKey: keys.activity, queryFn: () => api.activity(100) })
export const useEntry = (id: string | undefined) =>
  useQuery({ queryKey: keys.entry(id ?? ''), queryFn: () => api.entry(id!), enabled: Boolean(id) })

export const useReviews = () => useQuery({ queryKey: keys.reviews, queryFn: api.reviews })
export const useShortcuts = () => useQuery({ queryKey: keys.shortcuts, queryFn: api.shortcuts })
export const useTreatSummary = (id: string) => useQuery({ queryKey: keys.treats(id), queryFn: () => api.treatSummary(id) })
export const useShareLink = (id: string) => useQuery({ queryKey: keys.shareLink(id), queryFn: () => api.activeShareLink(id) })
export const useKitty = (id: string, enabled: boolean) =>
  useQuery({ queryKey: keys.kitty(id), queryFn: () => api.groupKitty(id), enabled })
export const useRecurring = (id: string, enabled: boolean) =>
  useQuery({ queryKey: keys.recurring(id), queryFn: () => api.recurring(id), enabled })
export const useReactions = (ids: string[]) =>
  useQuery({ queryKey: keys.reactions(ids), queryFn: () => api.reactionsFor(ids), enabled: ids.length > 0 })

const DEFAULT_PREFS = { style: 'baari' as const, tolerance: 10000, remind_above: 50000, remind_after_days: 14, last_nudged_at: null }

/** My settings for each friend, with defaults for anyone not in my contacts. */
export function useContactPrefs() {
  const query = useQuery({ queryKey: keys.contactPrefs, queryFn: api.contactPrefs })
  return useMemo(() => {
    const byId = new Map((query.data ?? []).map((c) => [c.person_id, c]))
    const prefs = (id: string): ContactPrefs => byId.get(id) ?? { person_id: id, ...DEFAULT_PREFS }
    return { ...query, prefs }
  }, [query])
}

/** People keyed by id, plus a name lookup that never fails. */
export function usePeople() {
  const query = usePeopleList()
  return useMemo(() => {
    const byId = new Map<string, Person>((query.data ?? []).map((p) => [p.id, p]))
    const me = query.data?.find((p) => p.is_me) ?? null
    const name = (id: string, opts: { you?: boolean } = {}) => {
      if (opts.you !== false && id === me?.id) return 'You'
      return byId.get(id)?.display_name ?? 'Someone'
    }
    return { ...query, byId, me, name, list: query.data ?? [] }
  }, [query])
}

/** Balances keyed by person id (positive = they owe me). */
export function useBalances() {
  const query = useBalanceList()
  return useMemo(() => {
    const byId = new Map<string, Balance>((query.data ?? []).map((b) => [b.person_id, b]))
    const net = (id: string): Paise => byId.get(id)?.net ?? 0
    return { ...query, byId, net }
  }, [query])
}

export function useHouseholdOf() {
  const { data } = useHouseholds()
  return useMemo(() => {
    const map = new Map<string, Household>()
    for (const h of data ?? []) for (const m of h.memberIds) map.set(m, h)
    return map
  }, [data])
}

/** Wraps a mutation so every money-changing action refreshes everything that depends on it. */
export function useLedgerMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    // Not awaited: callers navigate right away and screens refetch in the background.
    onSuccess: () => {
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    },
  })
}
