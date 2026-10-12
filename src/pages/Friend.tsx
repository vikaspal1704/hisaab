import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { ForgiveSheet, FriendSettingsSheet, InviteSheet, LentSheet, NudgeSheet, ShareSheet } from '../components/FriendSheets'
import { IconDownload, IconGift, IconHandshake, IconHeartHand, IconQr, IconSettings, IconShare, IconSwap, IconWhatsApp } from '../components/icons'
import { KindIcon } from '../components/KindIcon'
import { useIsDesktop } from '../hooks/useMediaQuery'
import { toneClass } from '../components/Money'
import { HeaderButton, Page } from '../components/Page'
import { PayMeSheet } from '../components/PayMeSheet'
import { ButtonLink, Card, EmptyState, ErrorView, LoadingView, SectionTitle } from '../components/ui'
import {
  useBalances,
  useContactPrefs,
  useHouseholdOf,
  usePeople,
  usePersonLedger,
  useReactions,
  useTreatSummary,
} from '../hooks/queries'
import { relationState } from '../lib/baari'
import { friendlyError } from '../lib/errors'
import { formatDay, formatMonth } from '../lib/format'
import { useT } from '../lib/i18n'
import { formatINR } from '../lib/money'
import { formatPhone } from '../lib/phone'
import type { LedgerRow, Reaction } from '../lib/types'

type SheetName = 'settings' | 'lent' | 'forgive' | 'share' | 'nudge' | 'qr' | 'invite' | null

export function FriendPage() {
  const { id = '' } = useParams()
  const { t } = useT()
  const desktop = useIsDesktop()
  const people = usePeople()
  const balances = useBalances()
  const ledger = usePersonLedger(id)
  const householdOf = useHouseholdOf()
  const prefs = useContactPrefs().prefs(id)
  const treats = useTreatSummary(id)
  const entryIds = useMemo(() => (ledger.data ?? []).map((r) => r.entry_id), [ledger.data])
  const reactions = useReactions(entryIds)
  const [sheet, setSheet] = useState<SheetName>(null)

  const person = people.byId.get(id)
  const net = balances.net(id)
  const household = householdOf.get(id)

  const months = useMemo(() => {
    const groups: { month: string; rows: LedgerRow[] }[] = []
    for (const row of [...(ledger.data ?? [])].reverse()) {
      const month = formatMonth(row.occurred_on)
      const last = groups[groups.length - 1]
      if (last?.month === month) last.rows.push(row)
      else groups.push({ month, rows: [row] })
    }
    return groups
  }, [ledger.data])

  if (people.isPending || ledger.isPending) return <Page title="" back><LoadingView /></Page>
  if (!person) return <Page title="" back><ErrorView message={t('This person isn’t in your contacts.')} /></Page>
  if (ledger.error) return <Page title={person.display_name} back><ErrorView message={friendlyError(ledger.error)} onRetry={() => ledger.refetch()} /></Page>

  const name = person.display_name
  const baari = prefs.style === 'baari'
  const state = relationState(net, baari ? prefs.tolerance : 0)
  const headline =
    state.kind === 'even'
      ? net === 0
        ? t('All square')
        : t('Barabar 👍')
      : baari
        ? state.kind === 'they_owe'
          ? t('{name}’s baari next', { name })
          : t('Your baari next')
        : state.kind === 'they_owe'
          ? t('Owes you {amount}', { amount: formatINR(net) })
          : t('You owe {amount}', { amount: formatINR(-net) })
  const detail =
    net === 0
      ? null
      : state.kind === 'even'
        ? t('{amount} difference — close enough', { amount: formatINR(Math.abs(net)) })
        : baari
          ? state.kind === 'they_owe'
            ? t('{name} is behind by {amount}', { name, amount: formatINR(net) })
            : t('You’re behind by {amount}. Pay the next bill with {name} and it evens out.', { amount: formatINR(-net), name })
          : null
  const reactionOf = (entryId: string) => reactions.data?.find((r) => r.entry_id === entryId && r.person_id === id)

  const mainActions = (
    <div className="flex gap-3 pb-1 lg:pb-0">
      <ButtonLink to={`/add?with=${id}`} variant="secondary" className="flex-1">{t('Add expense')}</ButtonLink>
      <ButtonLink to={`/settle/person/${id}`} className="flex-1"><IconSwap size={18} /> {t('Settle up')}</ButtonLink>
    </div>
  )
  const pill = 'inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors'
  const soft = `${pill} bg-white text-slate-700 shadow-card ring-1 ring-slate-200/80 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700`

  return (
    <Page
      title={name}
      back
      actions={
        person.is_contact ? (
          <HeaderButton label={t('Settings')} onClick={() => setSheet('settings')}>
            <IconSettings />
          </HeaderButton>
        ) : undefined
      }
      wide
      footer={desktop ? undefined : mainActions}
    >
      <div className="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div className="lg:sticky lg:top-8">
      <div className="flex flex-col items-center pt-2 text-center lg:rounded-3xl lg:bg-white lg:p-6 lg:shadow-card lg:ring-1 lg:ring-slate-200/70 dark:lg:bg-slate-900 dark:lg:ring-slate-800">
        <Avatar id={person.id} name={name} size={72} />
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {formatPhone(person.phone)} · {baari ? t('Baari') : t('Exact splits')}
        </p>
        <p className={`mt-3 text-2xl font-bold ${state.kind === 'even' ? 'text-slate-600 dark:text-slate-300' : toneClass(net)}`}>{headline}</p>
        {detail ? <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">{detail}</p> : null}

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => setSheet('lent')} className={soft}><IconHandshake size={17} /> {t('Lent / borrowed')}</button>
          <Link to={`/treat?with=${id}`} className={soft}><IconGift size={17} /> {t('Treat')}</Link>
          {net > 0 ? (
            <button type="button" onClick={() => setSheet('qr')} className={soft}><IconQr size={17} /> {t('QR to pay')}</button>
          ) : null}
          {net > 0 ? (
            <button type="button" onClick={() => setSheet('forgive')} className={soft}><IconHeartHand size={17} /> {t('Chhod do')}</button>
          ) : null}
          {state.kind === 'they_owe' ? (
            <button type="button" onClick={() => setSheet('nudge')} className={`${pill} bg-[#25D366]/15 text-[#0b7a63] hover:bg-[#25D366]/25 dark:text-[#25D366]`}>
              <IconWhatsApp size={18} /> {t('Remind')}
            </button>
          ) : null}
          <button type="button" onClick={() => setSheet('share')} className={soft}><IconShare size={17} /> {t('Share hisaab')}</button>
          <Link to={`/statement/p/${id}`} className={soft}><IconDownload size={17} /> {t('Export')}</Link>
          {!person.is_registered ? (
            <button type="button" onClick={() => setSheet('invite')} className={`${pill} bg-[#25D366]/15 text-[#0b7a63] hover:bg-[#25D366]/25 dark:text-[#25D366]`}>
              <IconWhatsApp size={18} /> {t('Invite')}
            </button>
          ) : null}
        </div>
        {!person.is_registered ? (
          <p className="mt-4 rounded-2xl bg-sky-50 p-3 text-left text-sm text-sky-900 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-100 dark:ring-sky-900">
            {t('{name} isn’t on Hisaab yet — that’s fine. Keep adding expenses: they’re saved against {phone}, and {name} sees all of it the day they join with that number.', {
              name: name.split(' ')[0],
              phone: formatPhone(person.phone),
            })}
          </p>
        ) : null}
        {household ? (
          <Link to={`/h/${household.id}`} className="mt-3 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400">
            {t('Part of “{name}” →', { name: household.name })}
          </Link>
        ) : null}
        {desktop ? <div className="mt-6 w-full">{mainActions}</div> : null}
      </div>

      {treats.data && (treats.data.i_gave > 0 || treats.data.they_gave > 0) ? (
        <Card className="mt-5 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold"><IconGift size={17} className="text-amber-600" /> {t('Treats')}</p>
          <p className="mt-1 text-slate-600 dark:text-slate-300">
            {t('You gave {mine} ({mineAmount}) · {name} gave {theirs} ({theirsAmount})', {
              mine: treats.data.i_gave,
              mineAmount: formatINR(treats.data.i_gave_amount),
              name,
              theirs: treats.data.they_gave,
              theirsAmount: formatINR(treats.data.they_gave_amount),
            })}
          </p>
          {treats.data.last_giver && treats.data.last_giver !== people.me?.id ? (
            <p className="mt-1 text-amber-700 dark:text-amber-300">{t('{name} gave the last treat — next one’s on you? 😄', { name })}</p>
          ) : null}
        </Card>
      ) : null}
      </div>

      <div className="lg:-mt-7">
      {months.length === 0 ? (
        <EmptyState title={t('No entries yet')} body={t('When you or {name} add an expense, it shows up here with a running balance.', { name })} />
      ) : (
        months.map((m) => (
          <section key={m.month}>
            <SectionTitle>{m.month}</SectionTitle>
            <Card className="divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
              {m.rows.map((row) => (
                <PassbookRow key={row.entry_id} row={row} name={name} reaction={reactionOf(row.entry_id)} />
              ))}
            </Card>
          </section>
        ))
      )}
      </div>
      </div>

      {sheet === 'settings' ? <FriendSettingsSheet open onClose={() => setSheet(null)} personId={id} prefs={prefs} currentName={name} /> : null}
      {sheet === 'lent' ? <LentSheet open onClose={() => setSheet(null)} personId={id} /> : null}
      {sheet === 'forgive' ? <ForgiveSheet open onClose={() => setSheet(null)} personId={id} owed={net} /> : null}
      {sheet === 'share' ? <ShareSheet open onClose={() => setSheet(null)} personId={id} /> : null}
      {sheet === 'invite' ? <InviteSheet open onClose={() => setSheet(null)} personId={id} /> : null}
      {sheet === 'qr' ? <PayMeSheet open onClose={() => setSheet(null)} amount={net} payerName={name} recordTo={`/settle/person/${id}`} /> : null}
      {sheet === 'nudge' ? <NudgeSheet open onClose={() => setSheet(null)} personId={id} amount={net} /> : null}
    </Page>
  )
}

function PassbookRow({ row, name, reaction }: { row: LedgerRow; name: string; reaction?: Reaction }) {
  const { t } = useT()
  const what =
    row.kind === 'forgive'
      ? row.delta > 0
        ? t('{name} let it go', { name })
        : t('You let it go')
      : row.kind === 'payment'
        ? row.delta > 0
          ? t('You paid {name}', { name })
          : t('{name} paid you', { name })
        : row.delta > 0
          ? t('{name} owes you', { name })
          : t('You owe {name}', { name })
  return (
    <Link to={`/e/${row.entry_id}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800/40 dark:active:bg-slate-800/60">
      <KindIcon kind={row.kind} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 font-medium break-words">{row.description}</span>
        <span className="block text-sm text-slate-500 dark:text-slate-400">
          {formatDay(row.occurred_on)} · {formatINR(row.amount)}
          {reaction?.status === 'confirmed' ? ` · ${t('{name} 👍', { name })}` : ''}
          {reaction?.status === 'questioned' ? ` · ❓ ${t('questioned')}` : ''}
        </span>
        <span className="mt-0.5 block text-xs text-slate-500 tabular-nums dark:text-slate-400">
          {row.running === 0
            ? t('Balance: settled')
            : row.running > 0
              ? t('Balance: {name} owes {amount}', { name, amount: formatINR(row.running) })
              : t('Balance: you owe {amount}', { amount: formatINR(-row.running) })}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`block font-semibold tabular-nums ${toneClass(row.delta)}`}>{formatINR(Math.abs(row.delta))}</span>
        <span className={`block text-xs ${toneClass(row.delta)}`}>{what}</span>
      </span>
    </Link>
  )
}
