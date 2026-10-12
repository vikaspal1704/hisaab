import { IconGroups } from '../components/icons'
import { Page } from '../components/Page'
import { ButtonLink, Card, EmptyState, ErrorView, LoadingView, Row } from '../components/ui'
import { useGroups } from '../hooks/queries'
import { friendlyError } from '../lib/errors'

export function GroupsPage() {
  const groups = useGroups()
  return (
    <Page title="Groups" withNav>
      {groups.isPending ? (
        <LoadingView />
      ) : groups.error ? (
        <ErrorView message={friendlyError(groups.error)} onRetry={() => groups.refetch()} />
      ) : groups.data.length === 0 ? (
        <EmptyState
          icon={<IconGroups size={40} />}
          title="Groups are optional"
          body="Make one for a crew you go out with or a trip. Hisaab then tells you whose turn it is to pay."
          action={<ButtonLink to="/groups/new" block>Create a group</ButtonLink>}
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
                subtitle={`${g.memberIds.length} people`}
              />
            ))}
          </Card>
          <ButtonLink to="/groups/new" variant="secondary" block className="mt-4">Create a group</ButtonLink>
        </>
      )}
    </Page>
  )
}
