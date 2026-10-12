import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { formatRelative } from '../lib/format'
import { useT } from '../lib/i18n'
import { formatINR } from '../lib/money'
import type { ReviewRow } from '../lib/types'
import { toneClass } from './Money'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { Button, Card, Field, TextInput } from './ui'

/** What an entry means for me, in one short phrase. */
export function useDeltaText() {
  const { t } = useT()
  return (kind: string, delta: number) => {
    const amount = formatINR(Math.abs(delta))
    if (delta === 0) return t('no change for you')
    if (kind === 'payment' || kind === 'forgive') return delta > 0 ? t('you paid {amount}', { amount }) : t('you received {amount}', { amount })
    return delta > 0 ? t('you get back {amount}', { amount }) : t('you owe {amount}', { amount })
  }
}

/** Entries someone else added about me: confirm or question them. */
export function ReviewCard({ rows }: { rows: ReviewRow[] }) {
  const { t } = useT()
  const people = usePeople()
  const toast = useToast()
  const deltaText = useDeltaText()
  const [questioning, setQuestioning] = useState<string | null>(null)
  const react = useLedgerMutation((args: { id: string; status: 'confirmed' | 'questioned'; note: string | null }) =>
    api.react(args.id, args.status, args.note),
  )
  if (rows.length === 0) return null
  return (
    <>
      <div className="mt-6 mb-2 flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">{t('To check')}</h2>
        <span className="rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
          {rows.length}
        </span>
      </div>
      <Card className="divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
        {rows.map((r) => (
          <div key={`${r.entry_id}-${r.state}`} className="px-4 py-3">
            <Link to={`/e/${r.entry_id}`} className="block">
              <span className="block">
                {r.state === 'questioned' ? '❓ ' : ''}
                <span className="font-medium">{people.name(r.actor_id)}</span> · {r.description}
              </span>
              <span className="block text-sm text-slate-500 dark:text-slate-400">
                {formatINR(r.amount)} · {formatRelative(r.at)} ·{' '}
                <span className={toneClass(r.my_delta)}>{deltaText(r.kind, r.my_delta)}</span>
              </span>
              {r.state === 'questioned' ? (
                <span className="mt-1 block text-sm text-amber-700 dark:text-amber-300">
                  {t('{name} asked:', { name: people.name(r.questioned_by ?? '') })} “{r.question_note ?? t('Is this right?')}”
                </span>
              ) : null}
            </Link>
            {r.state === 'pending' ? (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => react.mutate({ id: r.entry_id, status: 'confirmed', note: null }, { onSuccess: () => toast(t('Confirmed 👍')) })}
                  className="min-h-9 flex-1 rounded-full bg-brand-50 text-sm font-semibold text-brand-800 dark:bg-brand-800/30 dark:text-brand-100"
                >
                  {t('Looks right 👍')}
                </button>
                <button
                  type="button"
                  onClick={() => setQuestioning(r.entry_id)}
                  className="min-h-9 flex-1 rounded-full bg-slate-100 text-sm font-semibold dark:bg-slate-800"
                >
                  {t('Question ❓')}
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </Card>
      {react.error ? <p className="mt-2 text-sm text-red-600">{friendlyError(react.error)}</p> : null}
      <QuestionSheet
        open={questioning !== null}
        onClose={() => setQuestioning(null)}
        onSubmit={(note) =>
          react.mutate({ id: questioning!, status: 'questioned', note }, { onSuccess: () => { setQuestioning(null); toast(t('Sent')) } })
        }
        busy={react.isPending}
      />
    </>
  )
}

export function QuestionSheet({ open, onClose, onSubmit, busy }: { open: boolean; onClose: () => void; onSubmit: (note: string | null) => void; busy?: boolean }) {
  const { t } = useT()
  const [note, setNote] = useState('')
  return (
    <Sheet open={open} onClose={onClose} title={t('What doesn’t look right?')}>
      <Field label={t('Note (optional)')}>
        <TextInput value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. I only had one chai')} />
      </Field>
      <Button block className="mt-4" busy={busy} onClick={() => onSubmit(note.trim() || null)}>
        {t('Send question')}
      </Button>
    </Sheet>
  )
}
