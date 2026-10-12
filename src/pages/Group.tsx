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
import { formatINR, parseRupees, toRupeeInput } from '../lib/money'
import { whoPaysNext } from '../lib/settle'
import { buildSplit } from '../lib/split'
import { supabase } from '../lib/supabase'
import type { Group, PaymentMethod, RecurringRule } from '../lib/types'

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
  // While a kitty is open the holder is "behind" by design (they hold everyone's money).
  const turnMatters = turn && turn.behindBy > group.tolerance && !group.kittyHolder
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
            {people.name(turn.personId)}
          </p>
          <p className="text-sm">{t('Behind by {amount} in this group', { amount: formatINR(turn.behindBy) })}</p>
        </div>
      ) : (
        <p className="mt-2 rounded-2xl bg-white p-4 text-center text-sm text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          {t('Everyone in this group is even. Anyone can pay next!')}
        </p>
      )}

      {group.kind === 'office' && entries.data ? (
        // Keyed on the latest expense so defaults (amount, what) refresh once entries load or change.
        <TodayCard
          key={entries.data.find((e) => e.kind === 'expense')?.id ?? 'none'}
          group={group}
          entries={entries.data}
          nets={Object.fromEntries(rows.map((r) => [r.person_id, r.net]))}
        />
      ) : null}
      {group.kind === 'trip' ? <KittyCard group={group} /> : null}
      {group.kind === 'home' || group.kind === 'office' ? <RecurringCard group={group} /> : null}

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

      <SectionTitle
        action={
          <Link to={`/statement/g/${id}`} className="flex min-h-9 items-center text-sm font-semibold text-brand-700 dark:text-brand-500">
            ⬇️ {t('Export')}
          </Link>
        }
      >
        {t('Recent')}
      </SectionTitle>
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
  const [sheet, setSheet] = useState<'setup' | 'add' | 'close' | null>(null)
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
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => setSheet('add')}>{t('+ Add money')}</Button>
        {holderIsMe ? (
          <Button variant="secondary" className="flex-1" onClick={() => setSheet('close')}>{t('Close kitty')}</Button>
        ) : null}
      </div>
      {sheet === 'close' ? <CloseKittySheet group={group} onClose={() => setSheet(null)} /> : null}
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
  const [frequency, setFrequency] = useState<RecurringRule['frequency']>(group.kind === 'office' ? 'weekdays' : 'monthly')
  const [payer, setPayer] = useState(people.me?.id ?? group.memberIds[0])
  const stop = useLedgerMutation((id: string) => api.stopRecurring(id))
  const save = useLedgerMutation(async () => {
    const amount = parseRupees(amountText)
    const dayNum = Number(day)
    if (!description.trim()) throw new InputError(t('What is it for?'))
    if (!amount) throw new InputError(t('Enter an amount'))
    if (frequency === 'monthly' && (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 28)) {
      throw new InputError(t('Pick a day between 1 and 28'))
    }
    const units = group.memberIds.map((m) => ({ key: m, repId: m, memberIds: [m] }))
    const split = buildSplit({ amount, mode: 'equal', units, values: {}, payers: { [payer]: amount } })
    if (!split.ok) throw new InputError(t(split.error))
    return api.saveRecurring({ groupId: group.id, description: description.trim(), amount, splitMode: 'equal', parts: split.parts, dayOfMonth: frequency === 'monthly' ? dayNum : 1, startOn: todayISO(), frequency })
  })

  return (
    <Card className="mt-4 p-4">
      <p className="font-semibold">📅 {t('Repeats')}</p>
      {(rules.data ?? []).length === 0 ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {group.kind === 'office'
            ? t('Fixed daily costs like a snacks subscription — added every weekday, split equally.')
            : t('Add rent, WiFi, cook or Netflix once — Hisaab adds it every month, split equally.')}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
          {rules.data!.map((r) => {
            const paidBy = r.parts.find((p) => Number(p.paid) > 0)?.person_id
            return (
              <li key={r.id} className="flex min-h-12 items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{r.description} · {formatINR(r.amount)}</span>
                  <span className="block text-xs text-slate-500">
                    {r.frequency === 'monthly'
                      ? t('Day {day} · paid by {name} · next {date}', { day: r.day_of_month, name: paidBy ? people.name(paidBy) : '?', date: formatDay(r.next_on) })
                      : t('{freq} · paid by {name} · next {date}', {
                          freq: t(r.frequency === 'weekdays' ? 'Every weekday' : 'Every day'),
                          name: paidBy ? people.name(paidBy) : '?',
                          date: formatDay(r.next_on),
                        })}
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
      <Button variant="secondary" block className="mt-3" onClick={() => setOpen(true)}>{t('+ Repeating expense')}</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('Repeating expense')}>
        <div className="space-y-4">
          <Field label={t('What')}>
            <input value={description} maxLength={80} onChange={(e) => setDescription(e.target.value)} placeholder={t('e.g. Rent, WiFi, Cook')} className={inputClass} />
          </Field>
          <Segmented
            label={t('How often')}
            value={frequency}
            onChange={setFrequency}
            options={[
              { value: 'monthly', label: t('Monthly') },
              { value: 'weekdays', label: t('Weekdays') },
              { value: 'daily', label: t('Daily') },
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Amount')}>
              <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} className={inputClass} />
            </Field>
            {frequency === 'monthly' ? (
              <Field label={t('Day of month')}>
                <input inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} className={inputClass} />
              </Field>
            ) : null}
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
                  toast(t('Saved — added automatically'))
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

/** The holder returns what's left to each member (or collects a shortfall) and the kitty closes. */
function CloseKittySheet({ group, onClose }: { group: Group; onClose: () => void }) {
  const { t } = useT()
  const toast = useToast()
  const people = usePeople()
  const [method, setMethod] = useState<PaymentMethod>('upi')
  const settlement = useQuery({ queryKey: ['kitty-settlement', group.id], queryFn: () => api.kittySettlement(group.id) })
  const close = useLedgerMutation(() => api.closeKitty(group.id, method))
  const rows = (settlement.data ?? []).filter((r) => r.amount !== 0)
  return (
    <Sheet open onClose={onClose} title={t('Close kitty')}>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t('Settle the kitty with everyone in one go. Each line is recorded as a payment from you or to you.')}
      </p>
      {settlement.isPending ? (
        <LoadingView />
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm">{t('Nothing left to return — the kitty is already even.')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {rows.map((r) => (
            <li key={r.person_id} className="flex min-h-11 items-center justify-between">
              <span>{r.amount > 0 ? t('Return to {name}', { name: people.name(r.person_id) }) : t('{name} pays you', { name: people.name(r.person_id) })}</span>
              <span className="font-semibold tabular-nums">{formatINR(Math.abs(r.amount))}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-3">
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
        {close.error ? <p className="text-sm text-red-600">{friendlyError(close.error)}</p> : null}
        <Button
          block
          busy={close.isPending}
          onClick={() =>
            close.mutate(undefined, {
              onSuccess: () => {
                toast(t('Kitty closed'))
                onClose()
              },
            })
          }
        >
          {rows.length ? t('Done — record and close') : t('Close kitty')}
        </Button>
      </div>
    </Sheet>
  )
}

/**
 * Office chai in one tap: same amount and crew as last time, whoever's baari
 * it is pays. Tap a name to mark them away today.
 */
function TodayCard({
  group,
  entries,
  nets,
}: {
  group: Group
  entries: { id: string; kind: string; description: string; amount: number; occurred_on: string; created_by: string }[]
  nets: Record<string, number>
}) {
  const { t } = useT()
  const toast = useToast()
  const people = usePeople()
  const last = entries.find((e) => e.kind === 'expense')
  const [away, setAway] = useState<Set<string>>(new Set())
  const [amountText, setAmountText] = useState(last ? toRupeeInput(Number(last.amount)) : '')
  const [what, setWhat] = useState(last ? last.description.replace(/ · .*$/, '') : t('Chai'))
  const present = group.memberIds.filter((m) => !away.has(m))
  const turn = whoPaysNext(Object.fromEntries(present.map((m) => [m, nets[m] ?? 0])))
  const [payerChoice, setPayerChoice] = useState<string | null>(null)
  const payer = payerChoice && present.includes(payerChoice) ? payerChoice : (turn?.personId ?? people.me?.id ?? present[0])
  const doneToday = entries.some((e) => e.kind === 'expense' && e.occurred_on === todayISO() && e.description.startsWith(what))

  const log = useLedgerMutation(async () => {
    const amount = parseRupees(amountText)
    if (!amount) throw new InputError(t('Enter an amount'))
    if (present.length < 2) throw new InputError(t('At least two people need to be in today'))
    const units = present.map((m) => ({ key: m, repId: m, memberIds: [m] }))
    const split = buildSplit({ amount, mode: 'equal', units, values: {}, payers: { [payer]: amount } })
    if (!split.ok) throw new InputError(t(split.error))
    return api.saveExpense({
      entryId: null,
      description: what.trim() || t('Chai'),
      amount,
      occurredOn: todayISO(),
      groupId: group.id,
      splitMode: 'equal',
      parts: split.parts,
      expectedVersion: null,
    })
  })

  return (
    <Card className="mt-4 p-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold">☕ {t('Today')}</p>
        {doneToday ? <span className="text-sm font-semibold text-owed">✓ {t('Logged today')}</span> : null}
      </div>
      <div className="mt-3 grid grid-cols-[1fr_7rem] gap-2">
        <input aria-label={t('What')} value={what} maxLength={60} onChange={(e) => setWhat(e.target.value)} className={inputClass} />
        <input aria-label={t('Amount')} inputMode="decimal" placeholder="₹90" value={amountText} onChange={(e) => setAmountText(e.target.value)} className={inputClass} />
      </div>
      <p className="mt-3 mb-1.5 text-xs text-slate-500">{t('Who’s in today? Tap to mark someone away.')}</p>
      <div className="flex flex-wrap gap-2">
        {group.memberIds.map((m) => {
          const isAway = away.has(m)
          return (
            <button
              key={m}
              type="button"
              aria-pressed={!isAway}
              onClick={() => {
                const next = new Set(away)
                if (isAway) next.delete(m)
                else next.add(m)
                setAway(next)
              }}
              className={`min-h-9 rounded-full px-3 text-sm ring-1 ${isAway ? 'text-slate-400 line-through ring-slate-200 dark:ring-slate-700' : 'bg-white ring-slate-300 dark:bg-slate-900 dark:ring-slate-600'}`}
            >
              {people.name(m)}
            </button>
          )
        })}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <span className="text-slate-500">{t('Paid by')}</span>
        <select value={payer} onChange={(e) => setPayerChoice(e.target.value)} className="min-h-9 flex-1 rounded-lg bg-slate-100 px-2 dark:bg-slate-800">
          {present.map((m) => (
            <option key={m} value={m}>
              {people.name(m)}
              {turn?.personId === m ? ` — ${m === people.me?.id ? t('your baari') : t('their baari')}` : ''}
            </option>
          ))}
        </select>
      </label>
      {log.error ? <p className="mt-2 text-sm text-red-600">{friendlyError(log.error)}</p> : null}
      <Button
        block
        className="mt-3"
        busy={log.isPending}
        onClick={() => log.mutate(undefined, { onSuccess: () => toast(t('Logged for {n} people', { n: present.length })) })}
      >
        {parseRupees(amountText)
          ? t('Log {amount} · {name} paid', { amount: formatINR(parseRupees(amountText)!), name: people.name(payer) })
          : t('Log today’s chai')}
      </Button>
    </Card>
  )
}
