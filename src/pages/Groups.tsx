import { Link } from 'react-router-dom'
import { AvatarStack } from '../components/Avatar'
import { IconGroups, IconPlus } from '../components/icons'
import { Page } from '../components/Page'
import { ButtonLink, Card, EmptyState, ErrorView, LoadingView, Row } from '../components/ui'
import { useGroups, usePeople } from '../hooks/queries'
import { friendlyError } from '../lib/errors'
import { useT } from '../lib/i18n'

const KIND_LABEL = { friends: 'Friends', trip: 'Trip', home: 'Flat / home', office: 'Office crew', carpool: 'Car pool' } as const

export function GroupsPage() {
  const groups = useGroups()
  const people = usePeople()
  const { t } = useT()
  return (
    <Page title={t('Groups')} withNav wide>
      {groups.isPending ? (
        <LoadingView />
      ) : groups.error ? (
        <ErrorView message={friendlyError(groups.error)} onRetry={() => groups.refetch()} />
      ) : groups.data.length === 0 ? (
        <EmptyState
          icon={<IconGroups size={40} />}
          title={t('Groups are optional')}
          body={t('Make one for a crew you go out with, a trip or your flat. Hisaab then tells you whose baari it is.')}
          action={<ButtonLink to="/groups/new" block>{t('Create a group')}</ButtonLink>}
        />
      ) : (
        <>
          {/* Laptop: a grid of group cards. */}
          <div className="hidden gap-4 lg:grid lg:grid-cols-2 xl:grid-cols-3">
            {groups.data.map((g) => (
              <Link
                key={g.id}
                to={`/g/${g.id}`}
                className="group flex flex-col rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-raised dark:bg-slate-900 dark:ring-slate-800"
              >
                <span className="flex items-start justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">{g.emoji ?? '👥'}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t(KIND_LABEL[g.kind])}</span>
                </span>
                <span className="mt-4 block truncate text-lg font-semibold group-hover:text-brand-700 dark:group-hover:text-brand-400">{g.name}</span>
                <span className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                  <AvatarStack people={g.memberIds.slice(0, 4).map((m) => ({ id: m, name: people.name(m) }))} size={26} />
                  {t('{n} people', { n: g.memberIds.length })}
                </span>
              </Link>
            ))}
            <Link
              to="/groups/new"
              className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 text-slate-500 transition-colors hover:border-brand-500 hover:text-brand-700 dark:border-slate-700 dark:hover:text-brand-400"
            >
              <IconPlus size={24} />
              <span className="font-medium">{t('Create a group')}</span>
            </Link>
          </div>
          <div className="lg:hidden">
          <Card className="mt-2 divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
            {groups.data.map((g) => (
              <Row
                key={g.id}
                to={`/g/${g.id}`}
                leading={<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-xl dark:bg-slate-800">{g.emoji ?? '👥'}</span>}
                title={g.name}
                subtitle={t('{n} people · {kind}', { n: g.memberIds.length, kind: t(KIND_LABEL[g.kind]) })}
              />
            ))}
          </Card>
          <ButtonLink to="/groups/new" variant="secondary" block className="mt-4">{t('Create a group')}</ButtonLink>
          </div>
        </>
      )}
    </Page>
  )
}
