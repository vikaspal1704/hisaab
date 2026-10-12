import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Page } from '../components/Page'
import { ContactChecklist } from '../components/PeoplePicker'
import { useToast } from '../components/Toast'
import { Button, ErrorView, Field, LoadingView, SectionTitle, TextInput } from '../components/ui'
import { useGroups, useLedgerMutation } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import type { Group } from '../lib/types'

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
  const [emoji, setEmoji] = useState(existing?.emoji ?? '👥')
  const [selected, setSelected] = useState<Set<string>>(new Set(existing?.memberIds ?? []))
  const [error, setError] = useState<string | null>(null)
  const save = useLedgerMutation(async () => {
    if (existing) {
      const added = [...selected].filter((m) => !existing.memberIds.includes(m))
      await api.updateGroup(existing.id, name.trim(), emoji, added)
      return existing.id
    }
    return api.createGroup(name.trim(), emoji, [...selected])
  })

  const toggle = (personId: string) => {
    if (existing?.memberIds.includes(personId)) return // members can't be removed: their history stays in the group
    const next = new Set(selected)
    if (next.has(personId)) next.delete(personId)
    else next.add(personId)
    setSelected(next)
  }

  const submit = () => {
    if (!name.trim()) return setError('Give the group a name')
    setError(null)
    save.mutate(undefined, {
      onSuccess: (id) => {
        toast(existing ? 'Group updated' : 'Group created')
        navigate(`/g/${id}`, { replace: true })
      },
    })
  }

  return (
    <Page
      title={existing ? 'Edit group' : 'New group'}
      back
      footer={
        <div className="pb-1">
          {error || save.error ? <p className="mb-2 text-center text-sm text-red-600">{error ?? friendlyError(save.error)}</p> : null}
          <Button block busy={save.isPending} onClick={submit}>
            {existing ? 'Save' : `Create group${selected.size ? ` with ${selected.size + 1} people` : ''}`}
          </Button>
        </div>
      }
    >
      <div className="mt-2 space-y-4">
        <Field label="Group name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Friday gang, Goa 2026" maxLength={60} autoFocus={!existing} />
        </Field>
        <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Icon">
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
      <SectionTitle>Members {existing ? '(add more)' : ''}</SectionTitle>
      <ContactChecklist selected={selected} onToggle={toggle} />
    </Page>
  )
}
