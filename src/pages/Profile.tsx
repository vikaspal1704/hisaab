import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Avatar, AvatarStack } from '../components/Avatar'
import { Page } from '../components/Page'
import { useToast } from '../components/Toast'
import { Button, ButtonLink, Card, Field, LoadingView, Row, SectionTitle, TextInput } from '../components/ui'
import { useHouseholds, useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError, InputError } from '../lib/errors'
import { formatPhone } from '../lib/phone'
import { isLikelyUpiId } from '../lib/upi'

export function ProfilePage() {
  const { signOut } = useAuth()
  const people = usePeople()
  const households = useHouseholds()
  const me = people.me

  if (!me) return <Page title="Me" withNav><LoadingView /></Page>

  return (
    <Page title="Me" withNav>
      <div className="flex items-center gap-4 pt-2">
        <Avatar id={me.id} name={me.display_name} size={64} />
        <div>
          <p className="text-xl font-semibold">{me.display_name}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{formatPhone(me.phone)}</p>
        </div>
      </div>

      <ProfileForm key={`${me.display_name}|${me.upi_id}`} name={me.display_name} phone={me.phone} upi={me.upi_id ?? ''} />

      <SectionTitle action={<ButtonLink to="/pairs/new" variant="ghost" className="min-h-9 text-sm">+ New pair</ButtonLink>}>
        Couples & pairs
      </SectionTitle>
      {households.data && households.data.length > 0 ? (
        <Card className="divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
          {households.data.map((h) => (
            <Row
              key={h.id}
              to={`/h/${h.id}`}
              leading={<AvatarStack people={h.memberIds.map((m) => ({ id: m, name: people.name(m) }))} />}
              title={h.name}
              subtitle={h.memberIds.map((m) => people.name(m)).join(' · ')}
            />
          ))}
        </Card>
      ) : (
        <Card className="p-4 text-sm text-slate-600 dark:text-slate-300">
          Group a couple or roommates so you see one combined balance and either of them can settle for both.
        </Card>
      )}

      <SectionTitle>Install the app</SectionTitle>
      <Card className="space-y-2 p-4 text-sm text-slate-600 dark:text-slate-300">
        <p><strong>Android (Chrome):</strong> menu ⋮ → “Add to Home screen” / “Install app”.</p>
        <p><strong>iPhone (Safari):</strong> Share → “Add to Home Screen”.</p>
      </Card>

      <Button variant="secondary" block className="mt-6" onClick={signOut}>Sign out</Button>
    </Page>
  )
}

function ProfileForm({ name: initialName, phone, upi: initialUpi }: { name: string; phone: string; upi: string }) {
  const toast = useToast()
  const [name, setName] = useState(initialName)
  const [upi, setUpi] = useState(initialUpi)
  const save = useLedgerMutation(async () => {
    if (!name.trim()) throw new InputError('Name can’t be empty')
    if (upi.trim() && !isLikelyUpiId(upi)) throw new InputError('UPI ID looks like name@bank (e.g. ravi@okaxis)')
    await api.claimProfile(name.trim(), phone, upi.trim() || null)
  })
  const dirty = name !== initialName || upi !== initialUpi

  return (
    <>
      <SectionTitle>Profile</SectionTitle>
      <Card className="space-y-4 p-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field label="UPI ID" hint="Friends see this on “Settle up” so they can pay you in one tap.">
          <TextInput value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="yourname@okaxis" autoCapitalize="none" autoCorrect="off" />
        </Field>
        {save.error ? <p className="text-sm text-red-600">{friendlyError(save.error)}</p> : null}
        <Button block disabled={!dirty} busy={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => toast('Profile saved') })}>
          Save
        </Button>
      </Card>
    </>
  )
}
