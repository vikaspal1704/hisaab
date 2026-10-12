import { IconGroups } from '../components/icons'
import { Page } from '../components/Page'
import { ButtonLink, Card, EmptyState, ErrorView, LoadingView, Row } from '../components/ui'
import { useGroups } from '../hooks/queries'
import { friendlyError } from '../lib/errors'
import { useT } from '../lib/i18n'

export function GroupsPage() {
  const groups = useGroups()
  const { t } = useT()
  return (
    <Page title={t('Groups')} withNav>
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
          <Card className="mt-2 divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
            {groups.data.map((g) => (
              <Row
                key={g.id}
                to={`/g/${g.id}`}
                leading={<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-xl dark:bg-slate-800">{g.emoji ?? '👥'}</span>}
                title={g.name}
                subtitle={t('{n} people · {kind}', { n: g.memberIds.length, kind: t({ friends: 'Friends', trip: 'Trip', home: 'Flat / home' }[g.kind]) })}
              />
            ))}
          </Card>
          <ButtonLink to="/groups/new" variant="secondary" block className="mt-4">{t('Create a group')}</ButtonLink>
        </>
      )}
    </Page>
  )
}
