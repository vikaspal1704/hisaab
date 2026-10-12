import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { KindIcon } from '../components/KindIcon'
import { SearchBox } from '../components/PeoplePicker'
import { IconActivity } from '../components/icons'
import { toneClass } from '../components/Money'
import { Page } from '../components/Page'
import { Card, EmptyState, ErrorView, LoadingView } from '../components/ui'
import { useActivity, usePeople } from '../hooks/queries'
import { friendlyError } from '../lib/errors'
import { api } from '../lib/api'
import { formatDay, formatRelative } from '../lib/format'
import { useT } from '../lib/i18n'
import { formatINR } from '../lib/money'
import { markActivitySeen } from '../hooks/useUnread'
import type { ActivityRow, SearchRow } from '../lib/types'

export function ActivityPage() {
  const activity = useActivity()
  const people = usePeople()
  const { t } = useT()
  const newest = activity.data?.[0]?.event_id
  useEffect(() => {
    if (newest) markActivitySeen(newest)
  }, [newest])
  const [params] = useSearchParams()
  const [query, setQuery] = useState('')
  const focusSearch = params.get('search') === '1'
  const search = useDebounced(query.trim(), 250)

  return (
    <Page title={t('Activity')} withNav>
      <div className="mt-2">
        <SearchBox value={query} onChange={setQuery} placeholder={t('Search: dosa, Goa, Rahul, 450…')} autoFocus={focusSearch} />
      </div>
      {query.trim() ? (
        <SearchResults query={search} />
      ) : activity.isPending || people.isPending ? (
        <LoadingView />
      ) : activity.error ? (
        <ErrorView message={friendlyError(activity.error)} onRetry={() => activity.refetch()} />
      ) : activity.data.length === 0 ? (
        <EmptyState icon={<IconActivity size={40} />} title={t('Nothing yet')} body={t('Every expense, payment, edit and delete involving you shows up here.')} />
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

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** Every entry of mine matching what, item, group, friend or amount. */
function SearchResults({ query }: { query: string }) {
  const { t } = useT()
  const results = useQuery({ queryKey: ['search', query], queryFn: () => api.search(query), enabled: query.length > 0 })
  if (!query || results.isPending) return <LoadingView />
  if (results.error) return <ErrorView message={friendlyError(results.error)} onRetry={() => results.refetch()} />
  if (results.data.length === 0) return <EmptyState title={t('Nothing matches “{query}”', { query })} body={t('Try a friend’s name, a place, an item or an amount.')} />
  return (
    <>
      <p className="mt-3 px-1 text-sm text-slate-500">{t('{n} found', { n: results.data.length })}</p>
      <Card className="mt-2 divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
        {results.data.map((row) => (
          <SearchItem key={row.entry_id} row={row} />
        ))}
      </Card>
    </>
  )
}

function SearchItem({ row }: { row: SearchRow }) {
  const effect = useEffectText()({ ...row, is_deleted: false })
  return (
    <Link to={`/e/${row.entry_id}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800/40 dark:active:bg-slate-800/60">
      <KindIcon kind={row.kind} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{row.description}</span>
        <span className="block text-sm text-slate-500 dark:text-slate-400">
          {formatINR(row.amount)} · {formatDay(row.occurred_on)}
        </span>
        <span className={`block text-sm font-medium ${toneClass(effect.net)}`}>{effect.text}</span>
      </span>
    </Link>
  )
}

function useEffectText() {
  const { t } = useT()
  return (row: Pick<ActivityRow, 'is_deleted' | 'kind' | 'my_delta'>) => {
    if (row.is_deleted) return { text: t('no longer counts'), net: 0 }
    if (row.kind === 'treat') return { text: t('a treat 🎁 — nobody owes'), net: 0 }
    if (row.my_delta === 0) return { text: row.kind === 'payment' ? t('no change for you') : t('not involved'), net: 0 }
    const amount = formatINR(Math.abs(row.my_delta))
    if (row.kind === 'forgive') return { text: row.my_delta > 0 ? t('{amount} let go for you 🙏', { amount }) : t('you let go {amount}', { amount }), net: 0 }
    // Payments settle debts rather than create them, so they get a neutral colour.
    if (row.kind === 'payment') return { text: row.my_delta > 0 ? t('you paid {amount}', { amount }) : t('you received {amount}', { amount }), net: 0 }
    return { text: row.my_delta > 0 ? t('you get back {amount}', { amount }) : t('you owe {amount}', { amount }), net: row.my_delta }
  }
}


function ActivityItem({ row, actor }: { row: ActivityRow; actor: string }) {
  const { t } = useT()
  const effect = useEffectText()(row)
  const verb = t({ created: 'added', edited: 'edited', deleted: 'deleted', restored: 'restored' }[row.action])
  return (
    <Link to={`/e/${row.entry_id}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800/40 dark:active:bg-slate-800/60">
      <KindIcon kind={row.action === 'deleted' ? 'deleted' : row.kind} className="mt-0.5" />
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
