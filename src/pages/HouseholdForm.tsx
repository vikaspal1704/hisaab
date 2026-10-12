import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Page } from '../components/Page'
import { ContactChecklist } from '../components/PeoplePicker'
import { useToast } from '../components/Toast'
import { Button, Card, ErrorView, Field, LoadingView, SectionTitle, TextInput } from '../components/ui'
import { useHouseholds, useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import type { Household } from '../lib/types'

export function HouseholdFormPage() {
  const { id } = useParams()
  const households = useHouseholds()
  if (households.isPending) return <Page title="Pair" back><LoadingView /></Page>
  const existing = id ? households.data?.find((h) => h.id === id) : undefined
  if (id && !existing) return <Page title="Pair" back><ErrorView message="Pair not found." /></Page>
  return <HouseholdForm existing={existing ?? null} />
}

function HouseholdForm({ existing }: { existing: Household | null }) {
  const navigate = useNavigate()
  const toast = useToast()
  const people = usePeople()
  const [selected, setSelected] = useState<Set<string>>(new Set(existing?.memberIds ?? []))
  const [name, setName] = useState(existing?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const suggestedName = [...selected].map((id) => people.name(id).split(' ')[0]).join(' & ')

  const save = useLedgerMutation(() => api.saveHousehold(existing?.id ?? null, name.trim() || suggestedName, [...selected]))
  const remove = useLedgerMutation(() => api.deleteHousehold(existing!.id))

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const submit = () => {
    if (selected.size < 2) return setError('Pick at least 2 people')
    if (selected.size > 6) return setError('A pair can have at most 6 people')
    setError(null)
    save.mutate(undefined, {
      onSuccess: (id) => {
        toast(existing ? 'Pair updated' : 'Pair created')
        navigate(`/h/${id}`, { replace: true })
      },
    })
  }

  return (
    <Page
      title={existing ? 'Edit pair' : 'New pair'}
      back
      footer={
        <div className="pb-1">
          {error || save.error ? <p className="mb-2 text-center text-sm text-red-600">{error ?? friendlyError(save.error)}</p> : null}
          <Button block busy={save.isPending} onClick={submit}>Save pair</Button>
        </div>
      }
    >
      <Card className="mt-2 p-4 text-sm text-slate-600 dark:text-slate-300">
        A pair is a couple, roommates or family you deal with as one. You’ll see their combined balance, can split a bill
        with them “as one”, and either of them can settle for both. Only you see your pairs.
      </Card>
      <div className="mt-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestedName || 'e.g. Amit & Neha'} maxLength={60} />
        </Field>
      </div>
      <SectionTitle>Who’s in it</SectionTitle>
      <ContactChecklist selected={selected} onToggle={toggle} />
      {existing ? (
        <Button
          variant="danger"
          block
          className="mt-6"
          busy={remove.isPending}
          onClick={() => remove.mutate(undefined, { onSuccess: () => navigate('/', { replace: true }) })}
        >
          Remove pair (balances stay)
        </Button>
      ) : null}
    </Page>
  )
}
