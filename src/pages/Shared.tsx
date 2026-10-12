import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { QuestionSheet } from '../components/Review'
import { Card, EmptyState, LoadingView, SectionTitle } from '../components/ui'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { formatDay } from '../lib/format'
import { useT } from '../lib/i18n'
import { formatINR } from '../lib/money'
import { appUrl } from '../lib/share'
import type { Reaction } from '../lib/types'
import { upiPayLink } from '../lib/upi'

/**
 * What a friend sees from a shared link — no account needed. Everything is
 * shown from the friend's side ("you owe Vikas", not "Rahul owes you").
 */
export function SharedPage() {
  const { token = '' } = useParams()
  const { t, lang, setLang } = useT()
  const client = useQueryClient()
  const view = useQuery({ queryKey: ['shared', token], queryFn: () => api.sharedView(token), retry: false })
  const [questioning, setQuestioning] = useState<string | null>(null)
  const react = useMutation({
    mutationFn: (args: { entry: string; status: Reaction['status']; note: string | null }) => api.sharedReact(token, args.entry, args.status, args.note),
    onSuccess: () => client.invalidateQueries({ queryKey: ['shared', token] }),
  })

  if (view.isPending) return <LoadingView />
  if (view.error || !view.data) {
    return <EmptyState title={t('This link isn’t active')} body={t('Ask your friend to send a new one.')} />
  }
  const v = view.data
  const owner = v.owner_name.split(' ')[0]
  const balance = v.entries[0]?.running ?? 0 // newest first; positive = owner owes the friend

  return (
    <div className="pt-safe mx-auto min-h-dvh max-w-lg px-4 pb-10">
      <div className="flex items-center justify-between py-4">
        <p className="text-sm font-semibold text-brand-700 dark:text-brand-500">Hisaab</p>
        <button type="button" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')} className="min-h-9 rounded-full px-3 text-sm ring-1 ring-slate-300 dark:ring-slate-700">
          {lang === 'hi' ? 'English' : 'Hinglish'}
        </button>
      </div>
      <h1 className="text-2xl font-bold">{t('Hi {name} 👋', { name: v.friend_name.split(' ')[0] })}</h1>
      <p className="mt-1 text-slate-600 dark:text-slate-300">{t('This is your hisaab with {name}.', { name: v.owner_name })}</p>

      <div className="mt-4 rounded-3xl bg-gradient-to-br from-brand-700 to-brand-800 p-5 text-white">
        <p className="text-xl font-semibold">
          {balance === 0
            ? t('You two are all square 🎉')
            : balance > 0
              ? t('{name} owes you {amount}', { name: owner, amount: formatINR(balance) })
              : t('You owe {name} {amount}', { name: owner, amount: formatINR(-balance) })}
        </p>
        {balance < 0 ? (
          <p className="mt-1 text-sm text-brand-100">{t('Pick up the next bill with {name}, or pay whenever.', { name: owner })}</p>
        ) : null}
        {balance < 0 && v.owner_upi ? (
          <a
            href={upiPayLink({ upiId: v.owner_upi, name: v.owner_name, amount: -balance, note: 'Hisaab' })}
            className="mt-4 flex min-h-12 items-center justify-center rounded-xl bg-white font-semibold text-brand-800"
          >
            {t('Pay {amount} with a UPI app', { amount: formatINR(-balance) })}
          </a>
        ) : null}
      </div>

      <SectionTitle>{t('Entries')}</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {v.entries.map((e) => (
          <div key={e.entry_id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{e.description}</span>
                <span className="block text-sm text-slate-500">{formatDay(e.occurred_on)} · {formatINR(e.amount)}</span>
              </span>
              <span className={`shrink-0 text-right text-sm font-semibold ${e.delta > 0 ? 'text-owed' : 'text-owe'}`}>
                {e.delta > 0 ? t('+{amount} for you', { amount: formatINR(e.delta) }) : t('{amount} on you', { amount: formatINR(-e.delta) })}
              </span>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                aria-pressed={e.reaction === 'confirmed'}
                onClick={() => react.mutate({ entry: e.entry_id, status: 'confirmed', note: null })}
                className={`min-h-9 flex-1 rounded-full text-sm font-semibold ${e.reaction === 'confirmed' ? 'bg-brand-700 text-white' : 'bg-brand-50 text-brand-800 dark:bg-brand-800/30 dark:text-brand-100'}`}
              >
                {e.reaction === 'confirmed' ? t('Confirmed 👍') : t('Looks right 👍')}
              </button>
              <button
                type="button"
                aria-pressed={e.reaction === 'questioned'}
                onClick={() => setQuestioning(e.entry_id)}
                className={`min-h-9 flex-1 rounded-full text-sm font-semibold ${e.reaction === 'questioned' ? 'bg-amber-500 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}
              >
                {e.reaction === 'questioned' ? t('Questioned ❓') : t('Question ❓')}
              </button>
            </div>
          </div>
        ))}
      </Card>
      {react.error ? <p className="mt-2 text-sm text-red-600">{friendlyError(react.error)}</p> : null}

      <Card className="mt-6 p-4 text-sm">
        <p className="font-semibold">{t('Want your own hisaab with friends?')}</p>
        <p className="mt-1 text-slate-600 dark:text-slate-300">
          {t('Sign in with this number and everything here shows up automatically. Free, no ads.')}
        </p>
        <a href={appUrl()} className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-brand-700 font-semibold text-white">
          {t('Open Hisaab')}
        </a>
      </Card>

      <QuestionSheet
        open={questioning !== null}
        onClose={() => setQuestioning(null)}
        busy={react.isPending}
        onSubmit={(note) => react.mutate({ entry: questioning!, status: 'questioned', note }, { onSuccess: () => setQuestioning(null) })}
      />
    </div>
  )
}
