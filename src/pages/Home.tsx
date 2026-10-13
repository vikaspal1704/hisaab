import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Avatar, AvatarStack } from '../components/Avatar'
import { LentSheet, NudgeSheet } from '../components/FriendSheets'
import { IconBell, IconBolt, IconClipboard, IconGift, IconHandshake, IconScale, IconUserPlus } from '../components/icons'
import { StyledBalance } from '../components/Money'
import { HeaderButton, Page } from '../components/Page'
import { QuickAdd } from '../components/QuickAdd'
import { ReviewCard } from '../components/Review'
import { ButtonLink, Card, EmptyState, ErrorView, LoadingView, Row, SectionTitle } from '../components/ui'
import { useBalances, useContactPrefs, useHouseholds, usePeople, useReviews, useShortcuts } from '../hooks/queries'
import { useIsDesktop } from '../hooks/useMediaQuery'
import { relationState, type Style } from '../lib/baari'
import { friendlyError } from '../lib/errors'
import { useT } from '../lib/i18n'
import { formatINR, type Paise } from '../lib/money'
import { shouldNudge } from '../lib/nudge'

interface DashboardRow {
  key: string
  to: string
  title: string
  subtitle?: string
  net: Paise
  style: Style
  tolerance: Paise
  avatar: { id: string; name: string }[]
}

export function HomePage() {
  const navigate = useNavigate()
  const { t } = useT()
  const desktop = useIsDesktop()
  const people = usePeople()
  const balances = useBalances()
  const households = useHouseholds()
  const prefs = useContactPrefs()
  const reviews = useReviews()
  const shortcuts = useShortcuts()
  const [nudging, setNudging] = useState<{ id: string; amount: Paise } | null>(null)
  const [lending, setLending] = useState(false)

  const { rows, owedToMe, iOwe, nextBaari, nudges } = useMemo(() => {
    const inHousehold = new Set<string>()
    const rows: DashboardRow[] = []
    for (const h of households.data ?? []) {
      const members = h.memberIds.filter((id) => !people.byId.get(id)?.is_me)
      members.forEach((id) => inHousehold.add(id))
      const p = prefs.prefs(members[0] ?? '')
      rows.push({
        key: `h-${h.id}`,
        to: `/h/${h.id}`,
        title: h.name,
        subtitle: members.map((id) => people.name(id)).join(' · '),
        net: members.reduce((s, id) => s + balances.net(id), 0),
        style: p.style,
        tolerance: p.tolerance,
        avatar: members.map((id) => ({ id, name: people.name(id) })),
      })
    }
    for (const person of people.list) {
      if (person.is_me || inHousehold.has(person.id)) continue
      if (!person.is_contact && !balances.byId.has(person.id)) continue
      const p = prefs.prefs(person.id)
      rows.push({
        key: person.id,
        to: `/p/${person.id}`,
        title: person.display_name,
        subtitle: person.is_registered ? undefined : t('Not on Hisaab yet'),
        net: balances.net(person.id),
        style: p.style,
        tolerance: p.tolerance,
        avatar: [{ id: person.id, name: person.display_name }],
      })
    }
    const isOpen = (r: DashboardRow) => relationState(r.net, r.style === 'baari' ? r.tolerance : 0).kind !== 'even'
    rows.sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || Math.abs(b.net) - Math.abs(a.net) || a.title.localeCompare(b.title))

    let owedToMe = 0
    let iOwe = 0
    for (const b of balances.data ?? []) {
      if (b.net > 0) owedToMe += b.net
      else iOwe -= b.net
    }
    // My baari: people I'm behind with, beyond what counts as even.
    // Whose turn it is, both ways: people I'm behind with, and people behind with me.
    const nextBaari = rows
      .filter((r) => r.style === 'baari' && relationState(r.net, r.tolerance).kind !== 'even')
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    const nudges = (balances.data ?? [])
      .filter((b) => shouldNudge(b.net, b.last_activity, prefs.prefs(b.person_id)))
      .map((b) => ({ id: b.person_id, amount: b.net }))
    return { rows, owedToMe, iOwe, nextBaari, nudges }
  }, [people, balances, households.data, prefs, t])

  const loading = people.isPending || balances.isPending || households.isPending
  const error = people.error ?? balances.error ?? households.error
  const isOpen = (r: DashboardRow) => relationState(r.net, r.style === 'baari' ? r.tolerance : 0).kind !== 'even'
  const open = rows.filter(isOpen)
  const even = rows.filter((r) => !isOpen(r))

  return (
    <Page
      title={desktop ? greeting(t, people.me?.display_name) : 'Hisaab'}
      withNav
      wide
      actions={
        <>
          <HeaderButton label={t('Add friend')} onClick={() => navigate('/friends/new')}>
            <IconUserPlus />
          </HeaderButton>
          {people.me ? (
            <Link to="/me" aria-label={t('Me')} title={t('Me')} className="flex h-11 w-11 items-center justify-center rounded-full lg:hidden">
              <Avatar id={people.me.id} name={people.me.display_name} size={34} />
            </Link>
          ) : null}
        </>
      }
    >
      {loading ? (
        <LoadingView />
      ) : error ? (
        <ErrorView message={friendlyError(error)} onRetry={() => { people.refetch(); balances.refetch(); households.refetch() }} />
      ) : (
        <>
          {(() => {
            const quickActions = <QuickActions shortcuts={shortcuts.data ?? []} hasFriends={rows.length > 0} onLent={() => setLending(true)} />
            const reminders =
              nudges.length > 0 ? (
                <>
                  <SectionTitle>{t('Gentle reminders')}</SectionTitle>
                  <Card className="divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
                    {nudges.map((n) => (
                      <Row
                        key={n.id}
                        onClick={() => setNudging(n)}
                        leading={
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            <IconBell size={20} />
                          </span>
                        }
                        title={t('Remind {name}', { name: people.name(n.id) })}
                        subtitle={t('{amount} for a while — we’ll write it nicely', { amount: formatINR(n.amount) })}
                      />
                    ))}
                  </Card>
                </>
              ) : null
            const balancesList = (
              <>
                {rows.length === 0 ? (
                  <EmptyState
                    icon={<IconUserPlus size={40} />}
                    title={t('Add your friends')}
                    body={t('Add the people you go out with. When someone pays, add it here — Hisaab keeps the running total so you can just take turns.')}
                    action={
                      <div className="space-y-2">
                        <ButtonLink to="/friends/import" block>{t('Import from your contacts')}</ButtonLink>
                        <ButtonLink to="/friends/new" variant="secondary" block>{t('Add a friend')}</ButtonLink>
                      </div>
                    }
                  />
                ) : null}
                {open.length > 0 ? (
                  <>
                    <SectionTitle>{t('Balances')}</SectionTitle>
                    <Card className="divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
                      {open.map((r) => <DashboardItem key={r.key} row={r} />)}
                    </Card>
                  </>
                ) : null}
                {even.length > 0 ? (
                  <>
                    <SectionTitle>{t('All square')}</SectionTitle>
                    <Card className="divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
                      {even.map((r) => <DashboardItem key={r.key} row={r} />)}
                    </Card>
                  </>
                ) : null}
              </>
            )
            // Laptop: the ledger on the left, what needs doing on the right.
            if (desktop) {
              return (
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,22rem)] gap-8">
                  <div>
                    <QuickAdd />
                    {quickActions}
                    {balancesList}
                  </div>
                  <div className="-mt-2">
                    <BaariCard rows={nextBaari} />
                    <ReviewCard rows={reviews.data ?? []} />
                    {reminders}
                  </div>
                </div>
              )
            }
            return (
              <>
                <Summary owedToMe={owedToMe} iOwe={iOwe} />
                <QuickAdd />
                <BaariCard rows={nextBaari} />
                {quickActions}
                <ReviewCard rows={reviews.data ?? []} />
                {reminders}
                {balancesList}
              </>
            )
          })()}
        </>
      )}
      {lending ? <LentSheet open onClose={() => setLending(false)} /> : null}
      {nudging ? <NudgeSheet open onClose={() => setNudging(null)} personId={nudging.id} amount={nudging.amount} /> : null}
    </Page>
  )
}

function DashboardItem({ row }: { row: DashboardRow }) {
  return (
    <Row
      to={row.to}
      leading={row.avatar.length > 1 ? <AvatarStack people={row.avatar} /> : <Avatar id={row.avatar[0].id} name={row.avatar[0].name} />}
      title={row.title}
      subtitle={row.subtitle}
      trailing={<StyledBalance net={row.net} style={row.style} tolerance={row.tolerance} plural={row.avatar.length > 1} />}
      chevron={false}
    />
  )
}

function QuickActions({ shortcuts, hasFriends, onLent }: { shortcuts: { id: string; label: string }[]; hasFriends: boolean; onLent: () => void }) {
  const { t } = useT()
  if (!hasFriends) return null
  const chip =
    'flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-sm font-medium shadow-card ring-1 ring-slate-200/80 transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:ring-slate-700 dark:hover:bg-slate-800'
  const icon = 'text-brand-700 dark:text-brand-400'
  return (
    <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0" aria-label={t('Shortcuts')}>
      {shortcuts.map((s) => (
        <Link key={s.id} to={`/add?shortcut=${s.id}`} className={chip}>
          <IconBolt size={16} className="text-amber-500" /> {s.label}
        </Link>
      ))}
      <Link to="/add?paste=1" className={chip}><IconClipboard size={16} className={icon} /> {t('From UPI message')}</Link>
      <Link to="/treat" className={chip}><IconGift size={16} className={icon} /> {t('Treat')}</Link>
      <button type="button" onClick={onLent} className={chip}><IconHandshake size={16} className={icon} /> {t('Lent money')}</button>
    </div>
  )
}

function BaariCard({ rows }: { rows: DashboardRow[] }) {
  const { t } = useT()
  if (rows.length === 0) return null
  return (
    <>
      <SectionTitle>{t('Next baari')}</SectionTitle>
      <Card className="divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
        {rows.slice(0, 4).map((r) => (
          <Link key={r.key} to={r.to} className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
            <IconScale size={18} className={r.net < 0 ? 'text-owe dark:text-owe-dark' : 'text-owed dark:text-owed-dark'} />
            <span className="flex-1">
              {r.net < 0 ? t('Your baari with {name}', { name: r.title }) : t('{name}’s baari', { name: r.title })}
            </span>
            <span className={`font-semibold tabular-nums ${r.net < 0 ? 'text-owe dark:text-owe-dark' : 'text-owed dark:text-owed-dark'}`}>
              {formatINR(Math.abs(r.net))}
            </span>
          </Link>
        ))}
      </Card>
    </>
  )
}

function Summary({ owedToMe, iOwe }: { owedToMe: Paise; iOwe: Paise }) {
  const { t } = useT()
  const net = owedToMe - iOwe
  const headline =
    net > 0
      ? t('Overall, you are owed {amount}', { amount: formatINR(net) })
      : net < 0
        ? t('Overall, you owe {amount}', { amount: formatINR(-net) })
        : t('You’re all square')
  return (
    <div className="mt-2 rounded-3xl bg-gradient-to-br from-brand-700 to-brand-800 p-5 text-white shadow-lg shadow-brand-900/20">
      <p className="text-lg font-semibold">{headline}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/10 p-3">
          <p className="text-xs text-brand-100">{t('You’ll get back')}</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums">{formatINR(owedToMe)}</p>
        </div>
        <div className="rounded-2xl bg-white/10 p-3">
          <p className="text-xs text-brand-100">{t('You owe')}</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums">{formatINR(iOwe)}</p>
        </div>
      </div>
    </div>
  )
}

/** "Good evening, Vikas" for the laptop header. */
function greeting(t: (text: string, vars?: Record<string, string | number>) => string, name: string | undefined): string {
  const hour = new Date().getHours()
  const first = name?.split(' ')[0] ?? ''
  const text = hour < 12 ? t('Good morning, {name}', { name: first }) : hour < 17 ? t('Good afternoon, {name}', { name: first }) : t('Good evening, {name}', { name: first })
  return text
}
