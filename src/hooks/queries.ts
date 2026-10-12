import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../lib/api'
import type { Paise } from '../lib/money'
import type { Balance, Household, Person } from '../lib/types'

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
