import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { IconEdit } from '../components/icons'
import { BalanceLine } from '../components/Money'
import { HeaderButton, Page } from '../components/Page'
import { ButtonLink, Card, ErrorView, LoadingView, SectionTitle } from '../components/ui'
import { keys, useGroupBalances, useGroups, usePeople } from '../hooks/queries'
import { friendlyError } from '../lib/errors'
import { formatDay } from '../lib/format'
import { formatINR } from '../lib/money'
import { whoPaysNext } from '../lib/settle'
import { supabase } from '../lib/supabase'

export function GroupPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const groups = useGroups()
  const people = usePeople()
  const balances = useGroupBalances(id)
  const entries = useQuery({
    queryKey: keys.groupEntries(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entries')
        .select('id, kind, description, amount, occurred_on, created_by')
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
  const group = groups.data?.find((g) => g.id === id)
  if (!group) return <Page title="" back="/groups"><ErrorView message="Group not found." /></Page>
  if (balances.error) return <Page title={group.name} back><ErrorView message={friendlyError(balances.error)} /></Page>

  const rows = [...(balances.data ?? [])].sort((a, b) => a.net - b.net)
  const turn = whoPaysNext(Object.fromEntries(rows.map((r) => [r.person_id, r.net])))

  return (
    <Page
      title={`${group.emoji ?? '👥'} ${group.name}`}
      back
      actions={
        <HeaderButton label="Edit group" onClick={() => navigate(`/g/${id}/edit`)}>
          <IconEdit />
        </HeaderButton>
      }
      footer={<ButtonLink to={`/add?group=${id}`} block className="mb-1">Add a group expense</ButtonLink>}
    >
      {turn ? (
        <div className="mt-2 rounded-2xl bg-amber-50 p-4 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-900">
          <p className="text-sm">⚖️ Next turn to pay</p>
          <p className="mt-1 text-lg font-semibold">
            {people.name(turn.personId)} {people.me?.id === turn.personId ? '(you)' : ''}
          </p>
          <p className="text-sm">Behind by {formatINR(turn.behindBy)} in this group</p>
        </div>
      ) : (
        <p className="mt-2 rounded-2xl bg-white p-4 text-center text-sm text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          Everyone in this group is even. Anyone can pay next!
        </p>
      )}

      <SectionTitle>Balances in this group</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((r) => (
          <Link key={r.person_id} to={people.me?.id === r.person_id ? '/me' : `/p/${r.person_id}`} className="flex min-h-16 items-center gap-3 px-4 py-2">
            <Avatar id={r.person_id} name={people.name(r.person_id, { you: false })} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{people.name(r.person_id)}</span>
              <span className="block text-xs text-slate-500">paid {formatINR(r.paid_total)} · share {formatINR(r.owed_total)}</span>
            </span>
            <BalanceLine net={r.net} they="gets back" you="behind by" />
          </Link>
        ))}
      </Card>

      <SectionTitle>Recent</SectionTitle>
      {entries.isPending ? (
        <LoadingView />
      ) : (entries.data ?? []).length === 0 ? (
        <p className="px-1 text-sm text-slate-500">No group expenses yet.</p>
      ) : (
        <Card className="divide-y divide-slate-100 dark:divide-slate-800">
          {entries.data!.map((e) => (
            <Link key={e.id} to={`/e/${e.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <span aria-hidden>{e.kind === 'payment' ? '🤝' : '🧾'}</span>
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
