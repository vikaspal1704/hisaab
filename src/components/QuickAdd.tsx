import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBalances, useGroups, useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError, InputError } from '../lib/errors'
import { todayISO } from '../lib/format'
import { useT } from '../lib/i18n'
import { formatINR } from '../lib/money'
import { parseQuickAdd } from '../lib/quickAdd'
import { buildSplit } from '../lib/split'
import { useToast } from './Toast'
import { Card } from './ui'

type Crew = { kind: 'group'; id: string } | { kind: 'people'; ids: string[] }

/**
 * The fastest way to log: type "450 chai", tap who it was with, done.
 * Paid by me, split equally. Anything fancier goes through "More options".
 */
export function QuickAdd() {
  const { t } = useT()
  const navigate = useNavigate()
  const toast = useToast()
  const people = usePeople()
  const groups = useGroups()
  const balances = useBalances()
  const [text, setText] = useState('')
  const [crew, setCrew] = useState<Crew | null>(null)
  const parsed = parseQuickAdd(text)
  const me = people.me?.id

  // Most recent friends first, then the rest alphabetically.
  const friends = useMemo(() => {
    const recent = (id: string) => balances.byId.get(id)?.last_activity ?? ''
    return people.list
      .filter((p) => p.is_contact && !p.is_me)
      .sort((a, b) => recent(b.id).localeCompare(recent(a.id)) || a.display_name.localeCompare(b.display_name))
      .slice(0, 6)
  }, [people.list, balances.byId])
  const groupChips = (groups.data ?? []).slice(0, 3)

  const members = (): string[] => {
    if (!crew || !me) return []
    if (crew.kind === 'group') return groups.data?.find((g) => g.id === crew.id)?.memberIds ?? []
    return [me, ...crew.ids]
  }

  const save = useLedgerMutation(async () => {
    if (!parsed.amount) throw new InputError(t('Type an amount, like “450 chai”'))
    const ids = [...new Set(members())]
    if (!me || ids.length < 2) throw new InputError(t('Tap who it was with'))
    const units = ids.map((id) => ({ key: id, repId: id, memberIds: [id] }))
    const split = buildSplit({ amount: parsed.amount, mode: 'equal', units, values: {}, payers: { [me]: parsed.amount } })
    if (!split.ok) throw new InputError(t(split.error))
    return api.saveExpense({
      entryId: null,
      description: parsed.description || t('Expense'),
      amount: parsed.amount,
      occurredOn: todayISO(),
      groupId: crew?.kind === 'group' ? crew.id : null,
      splitMode: 'equal',
      parts: split.parts,
      expectedVersion: null,
    })
  })
  const undo = useLedgerMutation((id: string) => api.deleteEntry(id))

  const submit = () =>
    save.mutate(undefined, {
      onSuccess: (id) => {
        toast(t('Added {amount} · split {n} ways', { amount: formatINR(parsed.amount!), n: members().length }), {
          label: t('Undo'),
          run: () => undo.mutate(id),
        })
        setText('')
        setCrew(null)
      },
    })

  const toggleFriend = (id: string) => {
    const ids = crew?.kind === 'people' ? crew.ids : []
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    setCrew(next.length ? { kind: 'people', ids: next } : null)
  }

  if (friends.length === 0 && groupChips.length === 0) return null
  const chip = (active: boolean) =>
    `min-h-9 shrink-0 rounded-full px-3 text-sm font-medium ring-1 ${
      active
        ? 'bg-brand-700 text-white ring-brand-700'
        : 'bg-white ring-slate-200 transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:ring-slate-700 dark:hover:bg-slate-800'
    }`

  return (
    <Card className="mt-4 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('I paid… e.g. 450 chai')}
          aria-label={t('Quick add')}
          enterKeyHint="done"
          className="min-h-11 min-w-0 flex-1 rounded-xl bg-slate-100 px-3 text-base outline-none focus:ring-2 focus:ring-brand-600 dark:bg-slate-800"
        />
        <button
          type="submit"
          disabled={!parsed.amount || !crew || save.isPending}
          className="min-h-11 rounded-xl bg-brand-700 px-4 font-semibold text-white disabled:bg-slate-300 dark:disabled:bg-slate-700"
        >
          {t('Add')}
        </button>
      </form>
      <div className="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0" aria-label={t('With')}>
        {groupChips.map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={crew?.kind === 'group' && crew.id === g.id}
            onClick={() => setCrew(crew?.kind === 'group' && crew.id === g.id ? null : { kind: 'group', id: g.id })}
            className={chip(crew?.kind === 'group' && crew.id === g.id)}
          >
            {g.emoji ?? '👥'} {g.name}
          </button>
        ))}
        {friends.map((p) => {
          const active = crew?.kind === 'people' && crew.ids.includes(p.id)
          return (
            <button key={p.id} type="button" aria-pressed={active} onClick={() => toggleFriend(p.id)} className={chip(active)}>
              {p.display_name.split(' ')[0]}
            </button>
          )
        })}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>
          {parsed.amount && crew
            ? t('{amount} paid by you, split equally', { amount: formatINR(parsed.amount) })
            : t('Paid by you, split equally')}
        </span>
        <button
          type="button"
          className="min-h-8 font-semibold text-brand-700 dark:text-brand-500"
          onClick={() => {
            const params = new URLSearchParams()
            if (parsed.amount) params.set('amount', String(parsed.amount))
            if (parsed.description) params.set('desc', parsed.description)
            if (crew?.kind === 'group') params.set('group', crew.id)
            if (crew?.kind === 'people') params.set('with', crew.ids.join(','))
            navigate(`/add?${params}`)
          }}
        >
          {t('More options')}
        </button>
      </div>
      {save.error ? <p className="mt-1 text-sm text-red-600">{friendlyError(save.error)}</p> : null}
    </Card>
  )
}
