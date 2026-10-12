import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar, AvatarStack } from '../components/Avatar'
import { IconUserPlus } from '../components/icons'
import { BalanceLine } from '../components/Money'
import { HeaderButton, Page } from '../components/Page'
import { ButtonLink, Card, EmptyState, ErrorView, LoadingView, Row, SectionTitle } from '../components/ui'
import { useBalances, useHouseholds, usePeople } from '../hooks/queries'
import { friendlyError } from '../lib/errors'
import { formatINR, type Paise } from '../lib/money'

interface DashboardRow {
  key: string
  to: string
  title: string
  subtitle?: string
  net: Paise
  avatar: { id: string; name: string }[]
}

export function HomePage() {
  const navigate = useNavigate()
  const people = usePeople()
  const balances = useBalances()
  const households = useHouseholds()

  const { rows, owedToMe, iOwe } = useMemo(() => {
    const inHousehold = new Set<string>()
    const rows: DashboardRow[] = []
    for (const h of households.data ?? []) {
      const members = h.memberIds.filter((id) => !people.byId.get(id)?.is_me)
      members.forEach((id) => inHousehold.add(id))
      rows.push({
        key: `h-${h.id}`,
        to: `/h/${h.id}`,
        title: h.name,
        subtitle: members.map((id) => people.name(id)).join(' · '),
        net: members.reduce((s, id) => s + balances.net(id), 0),
        avatar: members.map((id) => ({ id, name: people.name(id) })),
      })
    }
    for (const p of people.list) {
      if (p.is_me || inHousehold.has(p.id)) continue
      if (!p.is_contact && !balances.byId.has(p.id)) continue
      rows.push({
        key: p.id,
        to: `/p/${p.id}`,
        title: p.display_name,
        subtitle: p.is_registered ? undefined : 'Not on Hisaab yet',
        net: balances.net(p.id),
        avatar: [{ id: p.id, name: p.display_name }],
      })
    }
    rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.title.localeCompare(b.title))

    let owedToMe = 0
    let iOwe = 0
    for (const b of balances.data ?? []) {
      if (b.net > 0) owedToMe += b.net
      else iOwe -= b.net
    }
    return { rows, owedToMe, iOwe }
  }, [people, balances, households.data])

  const loading = people.isPending || balances.isPending || households.isPending
  const error = people.error ?? balances.error ?? households.error
  const open = rows.filter((r) => r.net !== 0)
  const settled = rows.filter((r) => r.net === 0)

  return (
    <Page
      title="Hisaab"
      withNav
      actions={
        <HeaderButton label="Add friend" onClick={() => navigate('/friends/new')}>
          <IconUserPlus />
        </HeaderButton>
      }
    >
      {loading ? (
        <LoadingView />
      ) : error ? (
        <ErrorView message={friendlyError(error)} onRetry={() => { people.refetch(); balances.refetch(); households.refetch() }} />
      ) : (
        <>
          <Summary owedToMe={owedToMe} iOwe={iOwe} />

          {rows.length === 0 ? (
            <EmptyState
              icon={<IconUserPlus size={40} />}
              title="Add your friends"
              body="Add the people you go out with. When someone pays, add it here — Hisaab keeps the running total so you can just take turns."
              action={<ButtonLink to="/friends/new" block>Add a friend</ButtonLink>}
            />
          ) : null}

          {open.length > 0 ? (
            <>
              <SectionTitle>Balances</SectionTitle>
              <Card className="divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
                {open.map((r) => <DashboardItem key={r.key} row={r} />)}
              </Card>
            </>
          ) : null}

          {settled.length > 0 ? (
            <>
              <SectionTitle>All square</SectionTitle>
              <Card className="divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
                {settled.map((r) => <DashboardItem key={r.key} row={r} />)}
              </Card>
            </>
          ) : null}
        </>
      )}
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
      trailing={<BalanceLine net={row.net} they={row.avatar.length > 1 ? 'owe you' : 'owes you'} />}
      chevron={false}
    />
  )
}

function Summary({ owedToMe, iOwe }: { owedToMe: Paise; iOwe: Paise }) {
  const net = owedToMe - iOwe
  const headline =
    net > 0 ? `Overall, you are owed ${formatINR(net)}` : net < 0 ? `Overall, you owe ${formatINR(-net)}` : 'You’re all square'
  return (
    <div className="mt-2 rounded-3xl bg-gradient-to-br from-brand-700 to-brand-800 p-5 text-white shadow-lg shadow-brand-900/20">
      <p className="text-lg font-semibold">{headline}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/10 p-3">
          <p className="text-xs text-brand-100">You’ll get back</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums">{formatINR(owedToMe)}</p>
        </div>
        <div className="rounded-2xl bg-white/10 p-3">
          <p className="text-xs text-brand-100">You owe</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums">{formatINR(iOwe)}</p>
        </div>
      </div>
      {iOwe > 0 ? (
        <p className="mt-3 text-sm text-brand-100">Tip: pick up the next bill with the people you owe — it balances out automatically.</p>
      ) : null}
    </div>
  )
}
