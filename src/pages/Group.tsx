import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { IconEdit } from '../components/icons'
import { BalanceLine } from '../components/Money'
import { HeaderButton, Page } from '../components/Page'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { Button, ButtonLink, Card, ErrorView, Field, inputClass, LoadingView, Segmented, SectionTitle } from '../components/ui'
import { keys, useGroupBalances, useGroups, useKitty, useLedgerMutation, usePeople, useRecurring } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError, InputError } from '../lib/errors'
import { formatDay, todayISO } from '../lib/format'
import { useT } from '../lib/i18n'
import { formatINR, parseRupees } from '../lib/money'
import { whoPaysNext } from '../lib/settle'
import { buildSplit } from '../lib/split'
import { supabase } from '../lib/supabase'
import type { Group, PaymentMethod } from '../lib/types'

export function GroupPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { t } = useT()
  const groups = useGroups()
  const people = usePeople()
  const balances = useGroupBalances(id)
  const group = groups.data?.find((g) => g.id === id)
  const entries = useQuery({
    queryKey: keys.groupEntries(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entries')
        .select('id, kind, description, amount, occurred_on, created_by, kitty')
        .eq('group_id', id)
        .is('deleted_at', null)
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data
    },
  })

  if (groups.isPending || people.isPending || balances.isPending) return <Page title="" back><LoadingView /></Page>
  if (!group) return <Page title="" back="/groups"><ErrorView message={t('Group not found.')} /></Page>
  if (balances.error) return <Page title={group.name} back><ErrorView message={friendlyError(balances.error)} /></Page>

  const rows = [...(balances.data ?? [])].sort((a, b) => a.net - b.net)
  const turn = whoPaysNext(Object.fromEntries(rows.map((r) => [r.person_id, r.net])))
  const turnMatters = turn && turn.behindBy > group.tolerance
  const icon: Record<string, string> = { expense: '🧾', payment: '🤝', treat: '🎁', forgive: '🙏' }

  return (
    <Page
      title={`${group.emoji ?? '👥'} ${group.name}`}
      back
      actions={
        <HeaderButton label={t('Edit group')} onClick={() => navigate(`/g/${id}/edit`)}>
          <IconEdit />
        </HeaderButton>
      }
      footer={<ButtonLink to={`/add?group=${id}`} block className="mb-1">{t('Add a group expense')}</ButtonLink>}
    >
      {turnMatters ? (
        <div className="mt-2 rounded-2xl bg-amber-50 p-4 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-900">
          <p className="text-sm">⚖️ {group.kind === 'friends' ? t('Next baari') : t('Most behind')}</p>
          <p className="mt-1 text-lg font-semibold">
            {people.name(turn.personId)} {people.me?.id === turn.personId ? t('(you)') : ''}
          </p>
          <p className="text-sm">{t('Behind by {amount} in this group', { amount: formatINR(turn.behindBy) })}</p>
        </div>
      ) : (
        <p className="mt-2 rounded-2xl bg-white p-4 text-center text-sm text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          {t('Everyone in this group is even. Anyone can pay next!')}
        </p>
      )}

      {group.kind === 'trip' ? <KittyCard group={group} /> : null}
      {group.kind === 'home' ? <RecurringCard group={group} /> : null}

      <SectionTitle>{t('Balances in this group')}</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((r) => (
          <Link key={r.person_id} to={people.me?.id === r.person_id ? '/me' : `/p/${r.person_id}`} className="flex min-h-16 items-center gap-3 px-4 py-2">
            <Avatar id={r.person_id} name={people.name(r.person_id, { you: false })} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{people.name(r.person_id)}</span>
              <span className="block text-xs text-slate-500">
                {t('paid {paid} · share {share}', { paid: formatINR(r.paid_total), share: formatINR(r.owed_total) })}
              </span>
            </span>
            <BalanceLine net={Math.abs(r.net) <= group.tolerance ? 0 : r.net} they={t('gets back')} you={t('behind by')} />
          </Link>
        ))}
      </Card>

      <SectionTitle>{t('Recent')}</SectionTitle>
      {entries.isPending ? (
        <LoadingView />
      ) : (entries.data ?? []).length === 0 ? (
        <p className="px-1 text-sm text-slate-500">{t('No group expenses yet.')}</p>
      ) : (
        <Card className="divide-y divide-slate-100 dark:divide-slate-800">
          {entries.data!.map((e) => (
            <Link key={e.id} to={`/e/${e.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <span aria-hidden>{e.kitty ? '🏦' : (icon[e.kind] ?? '🧾')}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{e.description}</span>
                <span className="block text-xs text-slate-500">{formatDay(e.occurred_on)} · {people.name(e.created_by)}</span>
              </span>
              <span className="font-semibold tabular-nums">{formatINR(Number(e.amount))}</span>
            </Link>
          ))}
        </Card>
      )}
    </Page>
  )
}

/** Trip kitty: everyone chips in to one holder, spends come out of it. */
function KittyCard({ group }: { group: Group }) {
  const { t } = useT()
  const toast = useToast()
  const people = usePeople()
  const kitty = useKitty(group.id, Boolean(group.kittyHolder))
  const [sheet, setSheet] = useState<'setup' | 'add' | null>(null)
  const [holder, setHolder] = useState(group.kittyHolder ?? people.me?.id ?? group.memberIds[0])
  const [from, setFrom] = useState(group.memberIds.find((m) => m !== group.kittyHolder) ?? '')
  const [amountText, setAmountText] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('upi')
  const setup = useLedgerMutation(() => api.setGroupPrefs(group.id, group.kind, group.tolerance, holder))
  const add = useLedgerMutation(async () => {
    const amount = parseRupees(amountText)
    if (!amount) throw new InputError(t('Enter an amount'))
    return api.addToKitty(group.id, from, amount, todayISO(), method)
  })

  if (!group.kittyHolder) {
    return (
      <Card className="mt-4 p-4">
        <p className="font-semibold">🏦 {t('Trip kitty')}</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {t('Everyone puts money in with one person, and trip costs are paid from it. Hisaab tracks who put in what.')}
        </p>
        <Button variant="secondary" block className="mt-3" onClick={() => setSheet('setup')}>{t('Start a kitty')}</Button>
        <Sheet open={sheet === 'setup'} onClose={() => setSheet(null)} title={t('Who holds the kitty?')}>
          <div className="space-y-2">
            {group.memberIds.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={holder === m}
                onClick={() => setHolder(m)}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 ring-1 ${holder === m ? 'bg-brand-50 ring-2 ring-brand-600 dark:bg-brand-800/30' : 'ring-slate-200 dark:ring-slate-700'}`}
              >
                <Avatar id={m} name={people.name(m, { you: false })} size={32} /> {people.name(m)}
              </button>
            ))}
            {setup.error ? <p className="text-sm text-red-600">{friendlyError(setup.error)}</p> : null}
            <Button block busy={setup.isPending} onClick={() => setup.mutate(undefined, { onSuccess: () => setSheet(null) })}>{t('Start kitty')}</Button>
          </div>
        </Sheet>
      </Card>
    )
  }

  const left = (kitty.data?.collected ?? 0) - (kitty.data?.spent ?? 0)
  const holderIsMe = group.kittyHolder === people.me?.id
  return (
    <Card className="mt-4 p-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold">
          🏦 {holderIsMe ? t('Kitty is with you') : t('Kitty with {name}', { name: people.name(group.kittyHolder) })}
        </p>
        <p className={`font-bold tabular-nums ${left < 0 ? 'text-owe' : ''}`}>{formatINR(left)}</p>
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {t('Collected {collected} · spent {spent}', { collected: formatINR(kitty.data?.collected ?? 0), spent: formatINR(kitty.data?.spent ?? 0) })}
        {left < 0
          ? ` · ${holderIsMe ? t('You’ve covered {amount} extra', { amount: formatINR(-left) }) : t('{name} has covered {amount} extra', { name: people.name(group.kittyHolder), amount: formatINR(-left) })}`
          : ''}
      </p>
      <p className="mt-1 text-xs text-slate-500">{t('To pay from the kitty, add an expense and tick “Paid from the kitty”.')}</p>
      <Button variant="secondary" block className="mt-3" onClick={() => setSheet('add')}>{t('+ Money into kitty')}</Button>
      <Sheet open={sheet === 'add'} onClose={() => setSheet(null)} title={t('Money into the kitty')}>
        <div className="space-y-4">
          <Field label={t('Who put money in?')}>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass}>
              {group.memberIds
                .filter((m) => m !== group.kittyHolder)
                .map((m) => (
                  <option key={m} value={m}>{people.name(m)}</option>
                ))}
            </select>
          </Field>
          <Field label={t('Amount')}>
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="₹2000" className={inputClass} />
          </Field>
          <Segmented
            label={t('Payment method')}
            value={method}
            onChange={setMethod}
            options={[
              { value: 'upi', label: 'UPI' },
              { value: 'cash', label: t('Cash') },
              { value: 'bank', label: t('Bank') },
            ]}
          />
          {add.error ? <p className="text-sm text-red-600">{friendlyError(add.error)}</p> : null}
          <Button
            block
            busy={add.isPending}
            onClick={() =>
              add.mutate(undefined, {
                onSuccess: () => {
                  setAmountText('')
                  setSheet(null)
                  toast(t('Added to kitty'))
                },
              })
            }
          >
            {t('Add')}
          </Button>
        </div>
      </Sheet>
    </Card>
  )
}

/** Flatmates: rent, WiFi, cook… added automatically every month. */
function RecurringCard({ group }: { group: Group }) {
  const { t } = useT()
  const toast = useToast()
  const people = usePeople()
  const rules = useRecurring(group.id, true)
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [amountText, setAmountText] = useState('')
  const [day, setDay] = useState('1')
  const [payer, setPayer] = useState(people.me?.id ?? group.memberIds[0])
  const stop = useLedgerMutation((id: string) => api.stopRecurring(id))
  const save = useLedgerMutation(async () => {
    const amount = parseRupees(amountText)
    const dayNum = Number(day)
    if (!description.trim()) throw new InputError(t('What is it for?'))
    if (!amount) throw new InputError(t('Enter an amount'))
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 28) throw new InputError(t('Pick a day between 1 and 28'))
    const units = group.memberIds.map((m) => ({ key: m, repId: m, memberIds: [m] }))
    const split = buildSplit({ amount, mode: 'equal', units, values: {}, payers: { [payer]: amount } })
    if (!split.ok) throw new InputError(t(split.error))
    return api.saveRecurring({ groupId: group.id, description: description.trim(), amount, splitMode: 'equal', parts: split.parts, dayOfMonth: dayNum, startOn: todayISO() })
  })

  return (
    <Card className="mt-4 p-4">
      <p className="font-semibold">📅 {t('Every month')}</p>
      {(rules.data ?? []).length === 0 ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t('Add rent, WiFi, cook or Netflix once — Hisaab adds it every month, split equally.')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
          {rules.data!.map((r) => {
            const paidBy = r.parts.find((p) => Number(p.paid) > 0)?.person_id
            return (
              <li key={r.id} className="flex min-h-12 items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{r.description} · {formatINR(r.amount)}</span>
                  <span className="block text-xs text-slate-500">
                    {t('Day {day} · paid by {name} · next {date}', { day: r.day_of_month, name: paidBy ? people.name(paidBy) : '?', date: formatDay(r.next_on) })}
                  </span>
                </span>
                <button type="button" className="text-sm text-red-600" onClick={() => stop.mutate(r.id, { onSuccess: () => toast(t('Stopped')) })}>
                  {t('Stop')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <Button variant="secondary" block className="mt-3" onClick={() => setOpen(true)}>{t('+ Monthly bill')}</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('Monthly bill')}>
        <div className="space-y-4">
          <Field label={t('What')}>
            <input value={description} maxLength={80} onChange={(e) => setDescription(e.target.value)} placeholder={t('e.g. Rent, WiFi, Cook')} className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Amount')}>
              <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t('Day of month')}>
              <input inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <Field label={t('Who pays it')}>
            <select value={payer} onChange={(e) => setPayer(e.target.value)} className={inputClass}>
              {group.memberIds.map((m) => (
                <option key={m} value={m}>{people.name(m)}</option>
              ))}
            </select>
          </Field>
          <p className="text-sm text-slate-500">{t('Split equally between all {n} members.', { n: group.memberIds.length })}</p>
          {save.error ? <p className="text-sm text-red-600">{friendlyError(save.error)}</p> : null}
          <Button
            block
            busy={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  setOpen(false)
                  setDescription('')
                  setAmountText('')
                  toast(t('Saved — added automatically each month'))
                },
              })
            }
          >
            {t('Save')}
          </Button>
        </div>
      </Sheet>
    </Card>
  )
}
