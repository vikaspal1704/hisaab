import { useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { IconEdit, IconTrash } from '../components/icons'
import { HeaderButton, Page } from '../components/Page'
import { useToast } from '../components/Toast'
import { Button, Card, ErrorView, LoadingView, SectionTitle } from '../components/ui'
import { useEntry, useGroups, useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { formatDay, formatRelative } from '../lib/format'
import { formatINR } from '../lib/money'
import type { EntryDetail } from '../lib/types'

const METHOD_LABEL: Record<string, string> = { upi: 'UPI', cash: 'cash', bank: 'bank transfer', other: 'other' }

export function EntryPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const entry = useEntry(id)
  const people = usePeople()
  const groups = useGroups()
  const remove = useLedgerMutation(() => api.deleteEntry(id))
  const restore = useLedgerMutation(() => api.restoreEntry(id))

  if (entry.isPending || people.isPending) return <Page title="" back><LoadingView /></Page>
  if (entry.error) return <Page title="" back><ErrorView message={friendlyError(entry.error)} onRetry={() => entry.refetch()} /></Page>
  const e = entry.data
  if (!e) return <Page title="" back="/"><ErrorView message="This entry doesn’t exist or isn’t shared with you." /></Page>

  const deleted = Boolean(e.deleted_at)
  const group = groups.data?.find((g) => g.id === e.group_id)
  const meId = people.me?.id

  const onDelete = () => {
    if (!window.confirm('Delete this entry? Everyone on it will see that you deleted it, and you can restore it later.')) return
    remove.mutate(undefined, {
      onSuccess: () => toast('Entry deleted', { label: 'Undo', run: () => restore.mutate() }),
    })
  }

  return (
    <Page
      title={e.kind === 'payment' ? 'Payment' : 'Expense'}
      back
      actions={
        !deleted ? (
          <>
            {e.kind === 'expense' ? (
              <HeaderButton label="Edit" onClick={() => navigate(`/e/${id}/edit`)}>
                <IconEdit />
              </HeaderButton>
            ) : null}
            <HeaderButton label="Delete" onClick={onDelete}>
              <IconTrash />
            </HeaderButton>
          </>
        ) : undefined
      }
    >
      {deleted ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900">
          <span>Deleted — it no longer counts in anyone’s balance.</span>
          <Button variant="secondary" className="min-h-9 text-sm" busy={restore.isPending} onClick={() => restore.mutate()}>Restore</Button>
        </div>
      ) : null}

      <div className="pt-4 text-center">
        <p className="text-4xl font-bold tabular-nums">{formatINR(e.amount)}</p>
        <p className={`mt-1 text-lg ${deleted ? 'line-through opacity-60' : ''}`}>{e.description}</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {formatDay(e.occurred_on)}
          {group ? ` · ${group.emoji ?? '👥'} ${group.name}` : ''}
          {e.method ? ` · via ${METHOD_LABEL[e.method]}` : ''}
        </p>
      </div>

      {e.kind === 'expense' ? <ExpenseBreakdown e={e} name={people.name} /> : <PaymentBreakdown e={e} name={people.name} />}

      {meId ? <MyEffect e={e} meId={meId} name={people.name} /> : null}

      <SectionTitle>History</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {e.events.map((ev) => (
          <div key={ev.id} className="px-4 py-3 text-sm">
            <p>
              <span className="font-medium">{people.name(ev.actor_id)}</span> {ev.action} this
              <span className="text-slate-500 dark:text-slate-400"> · {formatRelative(ev.created_at)}</span>
            </p>
            {ev.action === 'edited' ? <EditDiff before={ev.before} /> : null}
          </div>
        ))}
      </Card>
      {remove.error || restore.error ? <p className="mt-3 text-sm text-red-600">{friendlyError(remove.error ?? restore.error)}</p> : null}
    </Page>
  )
}

function ExpenseBreakdown({ e, name }: { e: EntryDetail; name: (id: string, opts?: { you?: boolean }) => string }) {
  const payers = e.parts.filter((p) => p.paid > 0)
  const sharers = e.parts.filter((p) => p.owed > 0)
  return (
    <>
      <SectionTitle>Paid by</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {payers.map((p) => (
          <PersonAmount key={p.person_id} id={p.person_id} name={name(p.person_id)} avatarName={name(p.person_id, { you: false })} amount={p.paid} />
        ))}
      </Card>
      <SectionTitle>Split {e.split_mode === 'equal' ? 'equally' : e.split_mode === 'shares' ? 'by shares' : 'by amount'}</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {sharers.map((p) => (
          <PersonAmount
            key={p.person_id}
            id={p.person_id}
            name={name(p.person_id)}
            avatarName={name(p.person_id, { you: false })}
            amount={p.owed}
            note={p.shares ? `${p.shares} share${p.shares === 1 ? '' : 's'}` : undefined}
          />
        ))}
      </Card>
    </>
  )
}

function PaymentBreakdown({ e, name }: { e: EntryDetail; name: (id: string) => string }) {
  const from = e.parts.find((p) => p.paid > 0)?.person_id
  const to = e.parts.find((p) => p.owed > 0)?.person_id
  return (
    <>
      <Card className="mt-5 p-4 text-center">
        <p className="font-medium">
          {from ? name(from) : '?'} paid {to ? name(to) : '?'}
        </p>
      </Card>
      {e.allocations.length > 1 ? (
        <>
          <SectionTitle>This payment cleared</SectionTitle>
          <Card className="space-y-1.5 p-4 text-sm">
            {e.allocations.map((a, i) => (
              <p key={i}>
                {formatINR(a.amount)} of what {name(a.debtor)} owed {name(a.creditor)}
              </p>
            ))}
          </Card>
        </>
      ) : null}
    </>
  )
}

/** "What this means for you" in one line. */
function MyEffect({ e, meId, name }: { e: EntryDetail; meId: string; name: (id: string) => string }) {
  const mine = e.lines.filter((l) => l.debtor_id === meId || l.creditor_id === meId)
  if (mine.length === 0) return null
  return (
    <>
      <SectionTitle>For you</SectionTitle>
      <Card className="space-y-1.5 p-4 text-sm">
        {mine.map((l, i) =>
          e.kind === 'payment' ? (
            <p key={i}>
              {l.creditor_id === meId
                ? `Your balance with ${name(l.debtor_id)} moved ${formatINR(l.amount)} in your favour`
                : `Your balance with ${name(l.creditor_id)} moved ${formatINR(l.amount)} in their favour`}
            </p>
          ) : (
            <p key={i} className={l.creditor_id === meId ? 'text-owed dark:text-owed-dark' : 'text-owe dark:text-owe-dark'}>
              {l.creditor_id === meId ? `${name(l.debtor_id)} owes you ${formatINR(l.amount)}` : `You owe ${name(l.creditor_id)} ${formatINR(l.amount)}`}
            </p>
          ),
        )}
      </Card>
    </>
  )
}

function PersonAmount({ id, name, avatarName, amount, note }: { id: string; name: string; avatarName: string; amount: number; note?: string }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2">
      <Avatar id={id} name={avatarName} size={32} />
      <span className="flex-1 font-medium">{name}</span>
      {note ? <span className="text-xs text-slate-500">{note}</span> : null}
      <span className="font-semibold tabular-nums">{formatINR(amount)}</span>
    </div>
  )
}

function EditDiff({ before }: { before: unknown }) {
  const b = (before as { entry?: { amount?: number; description?: string } } | null)?.entry
  if (!b) return null
  return (
    <p className="mt-0.5 text-slate-500 dark:text-slate-400">
      Before: {b.description} · {formatINR(Number(b.amount ?? 0))}
    </p>
  )
}
