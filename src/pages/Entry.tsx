import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { IconEdit, IconTrash } from '../components/icons'
import { HeaderButton, Page } from '../components/Page'
import { useToast } from '../components/Toast'
import { Button, Card, ErrorView, LoadingView, SectionTitle } from '../components/ui'
import { useEntry, useGroups, useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { formatDay, formatRelative } from '../lib/format'
import { useT } from '../lib/i18n'
import { formatINR } from '../lib/money'
import { QuestionSheet } from '../components/Review'
import type { EntryDetail } from '../lib/types'

const KIND_TITLE: Record<string, string> = { expense: 'Expense', payment: 'Payment', forgive: 'Chhod diya', treat: 'Treat' }

/** Who has confirmed or questioned this entry, and my own buttons. */
function Confirmations({
  e,
  meId,
  name,
  onConfirm,
  onQuestion,
}: {
  e: EntryDetail
  meId: string
  name: (id: string) => string
  onConfirm: () => void
  onQuestion: () => void
}) {
  const { t } = useT()
  if (e.kind === 'treat') return null
  const lastActor = e.events[e.events.length - 1]?.actor_id
  const mine = e.reactions.find((r) => r.person_id === meId)
  const others = e.reactions.filter((r) => r.person_id !== meId)
  const canReact = lastActor !== meId && e.parts.some((p) => p.person_id === meId)
  if (!canReact && others.length === 0) return null
  return (
    <Card className="mt-5 space-y-2 p-4 text-sm">
      {others.map((r) => (
        <p key={r.person_id}>
          {r.status === 'confirmed' ? '👍' : '❓'} <span className="font-medium">{name(r.person_id)}</span>{' '}
          {r.status === 'confirmed' ? t('confirmed') : t('questioned this')}
          {r.note ? <span className="text-slate-500"> — “{r.note}”</span> : null}
        </p>
      ))}
      {canReact ? (
        mine ? (
          <p className="text-slate-500">
            {mine.status === 'confirmed' ? t('You confirmed this 👍') : t('You questioned this ❓')}{' '}
            <button type="button" className="font-semibold text-brand-700 dark:text-brand-500" onClick={mine.status === 'confirmed' ? onQuestion : onConfirm}>
              {mine.status === 'confirmed' ? t('Question instead') : t('Confirm instead')}
            </button>
          </p>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={onConfirm} className="min-h-10 flex-1 rounded-full bg-brand-50 font-semibold text-brand-800 dark:bg-brand-800/30 dark:text-brand-100">
              {t('Looks right 👍')}
            </button>
            <button type="button" onClick={onQuestion} className="min-h-10 flex-1 rounded-full bg-slate-100 font-semibold dark:bg-slate-800">
              {t('Question ❓')}
            </button>
          </div>
        )
      ) : null}
    </Card>
  )
}

const METHOD_LABEL: Record<string, string> = { upi: 'UPI', cash: 'cash', bank: 'bank transfer', other: 'other' }

export function EntryPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const entry = useEntry(id)
  const people = usePeople()
  const groups = useGroups()
  const { t } = useT()
  const [questioning, setQuestioning] = useState(false)
  const react = useLedgerMutation((args: { status: 'confirmed' | 'questioned'; note: string | null }) => api.react(id, args.status, args.note))
  const remove = useLedgerMutation(() => api.deleteEntry(id))
  const restore = useLedgerMutation(() => api.restoreEntry(id))

  if (entry.isPending || people.isPending) return <Page title="" back><LoadingView /></Page>
  if (entry.error) return <Page title="" back><ErrorView message={friendlyError(entry.error)} onRetry={() => entry.refetch()} /></Page>
  const e = entry.data
  if (!e) return <Page title="" back="/"><ErrorView message={t('This entry doesn’t exist or isn’t shared with you.')} /></Page>

  const deleted = Boolean(e.deleted_at)
  const group = groups.data?.find((g) => g.id === e.group_id)
  const meId = people.me?.id

  const onDelete = () => {
    if (!window.confirm(t('Delete this entry? Everyone on it will see that you deleted it, and you can restore it later.'))) return
    remove.mutate(undefined, {
      onSuccess: () => toast(t('Entry deleted'), { label: t('Undo'), run: () => restore.mutate() }),
    })
  }

  return (
    <Page
      title={t(KIND_TITLE[e.kind])}
      back
      actions={
        !deleted ? (
          <>
            {e.kind === 'expense' ? (
              <HeaderButton label={t('Edit')} onClick={() => navigate(`/e/${id}/edit`)}>
                <IconEdit />
              </HeaderButton>
            ) : null}
            <HeaderButton label={t('Delete')} onClick={onDelete}>
              <IconTrash />
            </HeaderButton>
          </>
        ) : undefined
      }
    >
      {deleted ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900">
          <span>{t('Deleted — it no longer counts in anyone’s balance.')}</span>
          <Button variant="secondary" className="min-h-9 text-sm" busy={restore.isPending} onClick={() => restore.mutate()}>{t('Restore')}</Button>
        </div>
      ) : null}

      <div className="pt-4 text-center">
        <p className="text-4xl font-bold tabular-nums">{formatINR(e.amount)}</p>
        <p className={`mt-1 text-lg ${deleted ? 'line-through opacity-60' : ''}`}>{e.description}</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {formatDay(e.occurred_on)}
          {group ? ` · ${group.emoji ?? '👥'} ${group.name}` : ''}
          {e.method ? ` · ${t('via {method}', { method: t(METHOD_LABEL[e.method]) })}` : ''}
          {e.kitty ? ` · 🏦 ${t('kitty')}` : ''}
        </p>
        {e.kind === 'treat' ? (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            🎁 {e.occasion ? `${t(e.occasion)} · ` : ''}{t('A treat — nobody owes anything.')}
          </p>
        ) : null}
        {e.kind === 'forgive' ? (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">🙏 {t('Let go as a gift — chhod diya.')}</p>
        ) : null}
        {!e.parts.some((p) => p.person_id === e.created_by) ? (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            📝{' '}
            {e.created_by === meId
              ? t('You added this for them — it doesn’t change your balance.')
              : t('Added by {name}, who isn’t part of it.', { name: people.name(e.created_by) })}
          </p>
        ) : null}
      </div>

      {!deleted && meId ? (
        <Confirmations
          e={e}
          meId={meId}
          name={people.name}
          onConfirm={() => react.mutate({ status: 'confirmed', note: null }, { onSuccess: () => toast(t('Confirmed 👍')) })}
          onQuestion={() => setQuestioning(true)}
        />
      ) : null}

      {e.kind === 'expense' || e.kind === 'treat' ? <ExpenseBreakdown e={e} name={people.name} /> : <PaymentBreakdown e={e} name={people.name} />}

      {e.kind === 'expense' && !deleted ? (
        <Link to={`/add?copy=${e.id}`} className="mt-4 flex min-h-11 items-center justify-center rounded-xl text-sm font-semibold text-brand-700 ring-1 ring-brand-600/40 dark:text-brand-500">
          ↻ {t('Add again (same people, today)')}
        </Link>
      ) : null}

      {meId ? <MyEffect e={e} meId={meId} name={people.name} /> : null}

      <SectionTitle>{t('History')}</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {e.events.map((ev) => (
          <div key={ev.id} className="px-4 py-3 text-sm">
            <p>
              <span className="font-medium">{people.name(ev.actor_id)}</span>{' '}
              {t({ created: 'created this', edited: 'edited this', deleted: 'deleted this', restored: 'restored this' }[ev.action])}
              <span className="text-slate-500 dark:text-slate-400"> · {formatRelative(ev.created_at)}</span>
            </p>
            {ev.action === 'edited' ? <EditDiff before={ev.before} /> : null}
          </div>
        ))}
      </Card>
      {remove.error || restore.error || react.error ? (
        <p className="mt-3 text-sm text-red-600">{friendlyError(remove.error ?? restore.error ?? react.error)}</p>
      ) : null}
      <QuestionSheet
        open={questioning}
        onClose={() => setQuestioning(false)}
        busy={react.isPending}
        onSubmit={(note) => react.mutate({ status: 'questioned', note }, { onSuccess: () => setQuestioning(false) })}
      />
    </Page>
  )
}

function ExpenseBreakdown({ e, name }: { e: EntryDetail; name: (id: string, opts?: { you?: boolean }) => string }) {
  const { t } = useT()
  const payers = e.parts.filter((p) => p.paid > 0)
  const isTreat = e.kind === 'treat'
  const sharers = isTreat ? e.parts.filter((p) => p.paid === 0) : e.parts.filter((p) => p.owed > 0)
  const splitTitle = isTreat
    ? t('Guests')
    : e.split_mode === 'equal'
      ? t('Split equally')
      : e.split_mode === 'shares'
        ? t('Split by shares')
        : e.split_mode === 'items'
          ? t('Split by item')
          : t('Split by amount')
  return (
    <>
      <SectionTitle>{isTreat ? t('Treat by') : t('Paid by')}</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {payers.map((p) => (
          <PersonAmount key={p.person_id} id={p.person_id} name={name(p.person_id)} avatarName={name(p.person_id, { you: false })} amount={p.paid} />
        ))}
      </Card>
      <SectionTitle>{splitTitle}</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {sharers.map((p) => (
          <PersonAmount
            key={p.person_id}
            id={p.person_id}
            name={name(p.person_id)}
            avatarName={name(p.person_id, { you: false })}
            amount={isTreat ? null : p.owed}
            note={p.shares ? t('{n} shares', { n: p.shares }) : undefined}
          />
        ))}
      </Card>
      {e.items ? <BillItems items={e.items} name={name} /> : null}
    </>
  )
}

/** The bill line by line, with who had each item. */
function BillItems({ items, name }: { items: NonNullable<EntryDetail['items']>; name: (id: string) => string }) {
  const { t } = useT()
  const extras = [
    { label: t('Tax & charges'), amount: Number(items.tax) },
    { label: t('Tip'), amount: Number(items.tip) },
    { label: t('Discount'), amount: -Number(items.discount) },
  ].filter((x) => x.amount !== 0)
  return (
    <>
      <SectionTitle>{t('The bill')}</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.lines.map((line, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{line.name}</span>
              <span className="block text-slate-500 dark:text-slate-400">{line.people.map((id) => name(id)).join(', ')}</span>
            </span>
            <span className="font-semibold tabular-nums">{formatINR(Number(line.amount))}</span>
          </div>
        ))}
        {extras.map((x) => (
          <div key={x.label} className="flex items-center justify-between px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300">
            <span>{x.label} <span className="text-xs text-slate-500">· {t('shared by what each had')}</span></span>
            <span className="tabular-nums">{formatINR(x.amount)}</span>
          </div>
        ))}
      </Card>
    </>
  )
}

function PaymentBreakdown({ e, name }: { e: EntryDetail; name: (id: string) => string }) {
  const { t } = useT()
  const from = e.parts.find((p) => p.paid > 0)?.person_id
  const to = e.parts.find((p) => p.owed > 0)?.person_id
  return (
    <>
      <Card className="mt-5 p-4 text-center">
        <p className="font-medium">
          {e.kind === 'forgive'
            ? t('{to} let go of what {from} owed', { to: to ? name(to) : '?', from: from ? name(from) : '?' })
            : t('{from} paid {to}', { from: from ? name(from) : '?', to: to ? name(to) : '?' })}
        </p>
      </Card>
      {e.allocations.length > 1 ? (
        <>
          <SectionTitle>{t('This payment cleared')}</SectionTitle>
          <Card className="space-y-1.5 p-4 text-sm">
            {e.allocations.map((a, i) => (
              <p key={i}>
                {t('{amount} of what {a} owed {b}', { amount: formatINR(a.amount), a: name(a.debtor), b: name(a.creditor) })}
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
  const { t } = useT()
  const mine = e.lines.filter((l) => l.debtor_id === meId || l.creditor_id === meId)
  if (mine.length === 0) return null
  return (
    <>
      <SectionTitle>{t('For you')}</SectionTitle>
      <Card className="space-y-1.5 p-4 text-sm">
        {mine.map((l, i) =>
          e.kind === 'payment' ? (
            <p key={i}>
              {l.creditor_id === meId
                ? t('Your balance with {name} moved {amount} in your favour', { name: name(l.debtor_id), amount: formatINR(l.amount) })
                : t('Your balance with {name} moved {amount} in their favour', { name: name(l.creditor_id), amount: formatINR(l.amount) })}
            </p>
          ) : (
            <p key={i} className={l.creditor_id === meId ? 'text-owed dark:text-owed-dark' : 'text-owe dark:text-owe-dark'}>
              {l.creditor_id === meId
                ? t('{name} owes you {amount}', { name: name(l.debtor_id), amount: formatINR(l.amount) })
                : t('You owe {name} {amount}', { name: name(l.creditor_id), amount: formatINR(l.amount) })}
            </p>
          ),
        )}
      </Card>
    </>
  )
}

function PersonAmount({ id, name, avatarName, amount, note }: { id: string; name: string; avatarName: string; amount: number | null; note?: string }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2">
      <Avatar id={id} name={avatarName} size={32} />
      <span className="flex-1 font-medium">{name}</span>
      {note ? <span className="text-xs text-slate-500">{note}</span> : null}
      {amount !== null ? <span className="font-semibold tabular-nums">{formatINR(amount)}</span> : null}
    </div>
  )
}

function EditDiff({ before }: { before: unknown }) {
  const { t } = useT()
  const b = (before as { entry?: { amount?: number; description?: string } } | null)?.entry
  if (!b) return null
  return (
    <p className="mt-0.5 text-slate-500 dark:text-slate-400">
      {t('Before:')} {b.description} · {formatINR(Number(b.amount ?? 0))}
    </p>
  )
}
