import { Link } from 'react-router-dom'
import { IconActivity } from '../components/icons'
import { toneClass } from '../components/Money'
import { Page } from '../components/Page'
import { Card, EmptyState, ErrorView, LoadingView } from '../components/ui'
import { useActivity, usePeople } from '../hooks/queries'
import { friendlyError } from '../lib/errors'
import { formatRelative } from '../lib/format'
import { formatINR } from '../lib/money'
import type { ActivityRow } from '../lib/types'

export function ActivityPage() {
  const activity = useActivity()
  const people = usePeople()

  return (
    <Page title="Activity" withNav>
      {activity.isPending || people.isPending ? (
        <LoadingView />
      ) : activity.error ? (
        <ErrorView message={friendlyError(activity.error)} onRetry={() => activity.refetch()} />
      ) : activity.data.length === 0 ? (
        <EmptyState icon={<IconActivity size={40} />} title="Nothing yet" body="Every expense, payment, edit and delete involving you shows up here." />
      ) : (
        <Card className="mt-2 divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
          {activity.data.map((row) => (
            <ActivityItem key={row.event_id} row={row} actor={people.name(row.actor_id)} />
          ))}
        </Card>
      )}
    </Page>
  )
}

function effectText(row: ActivityRow) {
  if (row.is_deleted) return { text: 'no longer counts', net: 0 }
  if (row.my_delta === 0) return { text: row.kind === 'payment' ? 'no change for you' : 'not involved', net: 0 }
  const amount = formatINR(Math.abs(row.my_delta))
  // Payments settle debts rather than create them, so they get a neutral colour.
  if (row.kind === 'payment') return { text: row.my_delta > 0 ? `you paid ${amount}` : `you received ${amount}`, net: 0 }
  return { text: row.my_delta > 0 ? `you get back ${amount}` : `you owe ${amount}`, net: row.my_delta }
}

function ActivityItem({ row, actor }: { row: ActivityRow; actor: string }) {
  const effect = effectText(row)
  const verb = { created: 'added', edited: 'edited', deleted: 'deleted', restored: 'restored' }[row.action]
  return (
    <Link to={`/e/${row.entry_id}`} className="flex items-start gap-3 px-4 py-3 active:bg-slate-50 dark:active:bg-slate-800/60">
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-lg dark:bg-slate-800" aria-hidden>
        {row.action === 'deleted' ? '🗑️' : row.kind === 'payment' ? '🤝' : '🧾'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">
          <span className="font-medium">{actor}</span> {verb} <span className="font-medium">“{row.description}”</span>
        </span>
        <span className="block text-sm text-slate-500 dark:text-slate-400">
          {formatINR(row.amount)} · {formatRelative(row.at)}
        </span>
        <span className={`block text-sm font-medium ${toneClass(effect.net)}`}>{effect.text}</span>
      </span>
    </Link>
  )
}
