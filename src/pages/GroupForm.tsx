import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Page } from '../components/Page'
import { ContactChecklist } from '../components/PeoplePicker'
import { useToast } from '../components/Toast'
import { Button, ErrorView, Field, LoadingView, SectionTitle, TextInput } from '../components/ui'
import { useGroups, useLedgerMutation } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { useT } from '../lib/i18n'
import type { Group, GroupKind } from '../lib/types'

const KINDS: { value: GroupKind; label: string; hint: string; emoji: string }[] = [
  { value: 'friends', label: 'Friends hangout', hint: 'Take turns paying. Small differences count as even.', emoji: '🍻' },
  { value: 'trip', label: 'Trip', hint: 'Exact splits, and an optional kitty everyone chips into.', emoji: '✈️' },
  { value: 'home', label: 'Flat / home', hint: 'Exact splits, plus monthly bills like rent and WiFi.', emoji: '🏠' },
]

const EMOJIS = ['👥', '🍻', '🍕', '✈️', '🏠', '🏏', '🎉', '💼', '🎓', '🏖️']

export function GroupFormPage() {
  const { id } = useParams()
  const groups = useGroups()
  if (id && groups.isPending) return <Page title="Edit group" back><LoadingView /></Page>
  const existing = id ? groups.data?.find((g) => g.id === id) : undefined
  if (id && !existing) return <Page title="Edit group" back><ErrorView message="Group not found." /></Page>
  return <GroupForm existing={existing ?? null} />
}

function GroupForm({ existing }: { existing: Group | null }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [name, setName] = useState(existing?.name ?? '')
  const { t } = useT()
  const [emoji, setEmoji] = useState(existing?.emoji ?? '🍻')
  const [kind, setKind] = useState<GroupKind>(existing?.kind ?? 'friends')
  const [selected, setSelected] = useState<Set<string>>(new Set(existing?.memberIds ?? []))
  const [error, setError] = useState<string | null>(null)
  const save = useLedgerMutation(async () => {
    if (existing) {
      const added = [...selected].filter((m) => !existing.memberIds.includes(m))
      await api.updateGroup(existing.id, name.trim(), emoji, added)
      if (kind !== existing.kind) await api.setGroupPrefs(existing.id, kind, kind === 'friends' ? 10000 : 0, existing.kittyHolder)
      return existing.id
    }
    const id = await api.createGroup(name.trim(), emoji, [...selected])
    if (kind !== 'friends') await api.setGroupPrefs(id, kind, 0, null)
    return id
  })

  const toggle = (personId: string) => {
    if (existing?.memberIds.includes(personId)) return // members can't be removed: their history stays in the group
    const next = new Set(selected)
    if (next.has(personId)) next.delete(personId)
    else next.add(personId)
    setSelected(next)
  }

  const submit = () => {
    if (!name.trim()) return setError(t('Give the group a name'))
    setError(null)
    save.mutate(undefined, {
      onSuccess: (id) => {
        toast(existing ? t('Group updated') : t('Group created'))
        navigate(`/g/${id}`, { replace: true })
      },
    })
  }

  return (
    <Page
      title={existing ? t('Edit group') : t('New group')}
      back
      footer={
        <div className="pb-1">
          {error || save.error ? <p className="mb-2 text-center text-sm text-red-600">{error ?? friendlyError(save.error)}</p> : null}
          <Button block busy={save.isPending} onClick={submit}>
            {existing ? t('Save') : selected.size ? t('Create group with {n} people', { n: selected.size + 1 }) : t('Create group')}
          </Button>
        </div>
      }
    >
      <div className="mt-2 space-y-4">
        <Field label={t('Group name')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Friday gang, Goa 2026')} maxLength={60} autoFocus={!existing} />
        </Field>
        <div role="radiogroup" aria-label={t('Type')} className="space-y-2">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => {
                setKind(k.value)
                if (!existing) setEmoji(k.emoji)
              }}
              className={`flex w-full items-start gap-3 rounded-2xl p-3 text-left ring-1 ${kind === k.value ? 'bg-brand-50 ring-2 ring-brand-600 dark:bg-brand-800/30' : 'bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-700'}`}
            >
              <span className="text-xl" aria-hidden>{k.emoji}</span>
              <span>
                <span className="block font-medium">{t(k.label)}</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">{t(k.hint)}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label={t('Icon')}>
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              role="radio"
              aria-checked={emoji === e}
              onClick={() => setEmoji(e)}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl ${emoji === e ? 'bg-brand-100 ring-2 ring-brand-600 dark:bg-brand-800/40' : 'bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700'}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <SectionTitle>{existing ? t('Members (add more)') : t('Members')}</SectionTitle>
      <ContactChecklist selected={selected} onToggle={toggle} />
    </Page>
  )
}
