import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Page } from '../components/Page'
import { ContactChecklist } from '../components/PeoplePicker'
import { useToast } from '../components/Toast'
import { IconTrash } from '../components/icons'
import { Sheet } from '../components/Sheet'
import { Button, Card, ErrorView, Field, LoadingView, SectionTitle, TextInput } from '../components/ui'
import { keys, useGroups, useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError, InputError } from '../lib/errors'
import { formatINR, parseRupees, toRupeeInput } from '../lib/money'
import { useT } from '../lib/i18n'
import type { CarpoolStyle } from '../lib/carpool'
import type { Group, GroupKind } from '../lib/types'

const KINDS: { value: GroupKind; label: string; hint: string; emoji: string }[] = [
  { value: 'friends', label: 'Friends hangout', hint: 'Take turns paying. Small differences count as even.', emoji: '🍻' },
  { value: 'trip', label: 'Trip', hint: 'Exact splits, and an optional kitty everyone chips into.', emoji: '✈️' },
  { value: 'home', label: 'Flat / home', hint: 'Exact splits, plus monthly bills like rent and WiFi.', emoji: '🏠' },
  { value: 'office', label: 'Office crew', hint: 'Daily chai and snacks in one tap. Take turns; small differences count as even.', emoji: '☕' },
  { value: 'carpool', label: 'Car pool', hint: 'Log morning and evening rides in two taps: a fare to the driver, pay by distance, split the fuel, or just take turns.', emoji: '🚗' },
]

const CARPOOL_STYLES: { value: CarpoolStyle; label: string; hint: string; amountLabel?: string }[] = [
  { value: 'fare', label: 'Riders pay a fare', hint: 'Each rider pays the driver a fixed amount per trip.', amountLabel: 'Fare per rider, per trip (₹)' },
  {
    value: 'distance',
    label: 'Riders pay by distance',
    hint: 'Each rider pays the driver for the km they ride, at a rate per km. Someone picked up halfway pays less.',
    amountLabel: 'Rate per km (₹)',
  },
  { value: 'split', label: 'Split the cost', hint: 'Whoever drives pays fuel/toll; it’s shared by everyone in the car.', amountLabel: 'Usual cost of one trip (₹)' },
  { value: 'turns', label: 'Take turns driving', hint: 'No money. Hisaab counts who drove and who rode, and says whose turn it is.' },
]

const EMOJIS = ['👥', '🍻', '🍕', '✈️', '🏠', '🏏', '🎉', '💼', '🎓', '🏖️', '🚗']

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
  const [toleranceText, setToleranceText] = useState(toRupeeInput(existing?.tolerance ?? 10000))
  const usesTolerance = kind === 'friends' || kind === 'office'
  const [carpoolStyle, setCarpoolStyle] = useState<CarpoolStyle>(existing?.carpoolStyle ?? 'split')
  const [carpoolAmountText, setCarpoolAmountText] = useState(existing?.carpoolAmount ? toRupeeInput(existing.carpoolAmount) : '')
  const [selected, setSelected] = useState<Set<string>>(new Set(existing?.memberIds ?? []))
  const people = usePeople()
  const distances = useQuery({
    queryKey: keys.carpoolDistances(existing?.id ?? ''),
    queryFn: () => api.carpoolDistances(existing!.id),
    enabled: Boolean(existing),
  })
  // Only the distances someone edited here; the rest come from the database.
  const [kmText, setKmText] = useState<Record<string, string>>({})
  const kmOf = (id: string) => kmText[id] ?? (distances.data?.get(id)?.toString() ?? '')
  const carMembers = [...new Set([...(existing ? existing.memberIds : people.me ? [people.me.id] : []), ...selected])]
  const [error, setError] = useState<string | null>(null)
  const carpoolChanged = (group: Group | null) =>
    kind === 'carpool' && (group?.carpoolStyle !== carpoolStyle || group?.carpoolAmount !== (parseRupees(carpoolAmountText) ?? null))
  const save = useLedgerMutation(async () => {
    const carpoolAmount = parseRupees(carpoolAmountText)
    if (kind === 'carpool' && carpoolStyle !== 'turns' && !carpoolAmount) {
      throw new InputError(
        t(carpoolStyle === 'fare' ? 'Enter the fare per rider' : carpoolStyle === 'distance' ? 'Enter the rate per km' : 'Enter the usual cost of a trip'),
      )
    }
    const kmChanges = kind === 'carpool' && carpoolStyle === 'distance'
      ? Object.entries(kmText).map(([personId, text]) => {
          const km = text.trim() ? Number(text.replace(',', '.')) : null
          if (km !== null && !(km > 0 && km <= 500)) throw new InputError(t('Distance must be between 0.1 and 500 km'))
          return { personId, km }
        })
      : []
    const saveDistances = async (groupId: string) => {
      for (const { personId, km } of kmChanges) {
        if (km !== null || distances.data?.has(personId)) await api.setCarpoolDistance(groupId, personId, km)
      }
    }
    if (existing) {
      const added = [...selected].filter((m) => !existing.memberIds.includes(m))
      await api.updateGroup(existing.id, name.trim(), emoji, added)
      const tol = usesTolerance ? parseRupees(toleranceText) ?? 0 : 0
      if (kind !== existing.kind || tol !== existing.tolerance) await api.setGroupPrefs(existing.id, kind, tol, existing.kittyHolder)
      if (carpoolChanged(existing)) await api.setCarpoolPrefs(existing.id, carpoolStyle, carpoolStyle === 'turns' ? null : carpoolAmount)
      await saveDistances(existing.id)
      return existing.id
    }
    const id = await api.createGroup(name.trim(), emoji, [...selected])
    if (kind !== 'friends') await api.setGroupPrefs(id, kind, usesTolerance ? 10000 : 0, null)
    if (kind === 'carpool') await api.setCarpoolPrefs(id, carpoolStyle, carpoolStyle === 'turns' ? null : carpoolAmount)
    await saveDistances(id)
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
        {kind === 'carpool' ? (
          <div className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
            <p className="text-sm font-medium">{t('How do you share costs?')}</p>
            <div role="radiogroup" aria-label={t('How do you share costs?')} className="space-y-1.5">
              {CARPOOL_STYLES.map((s) => (
                <label key={s.value} className="flex items-start gap-3 rounded-xl p-2">
                  <input type="radio" name="carpool-style" checked={carpoolStyle === s.value} onChange={() => setCarpoolStyle(s.value)} className="mt-1 h-5 w-5 accent-brand-700" />
                  <span>
                    <span className="block text-sm font-medium">{t(s.label)}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{t(s.hint)}</span>
                  </span>
                </label>
              ))}
            </div>
            {CARPOOL_STYLES.find((s) => s.value === carpoolStyle)?.amountLabel ? (
              <Field label={t(CARPOOL_STYLES.find((s) => s.value === carpoolStyle)!.amountLabel!)} hint={t('You can change it for any single trip.')}>
                <TextInput
                  inputMode="decimal"
                  value={carpoolAmountText}
                  onChange={(e) => setCarpoolAmountText(e.target.value)}
                  placeholder={carpoolStyle === 'fare' ? '80' : carpoolStyle === 'distance' ? '8' : '300'}
                />
              </Field>
            ) : null}
            {carpoolStyle === 'distance' ? (
              <div className="space-y-2 pt-1">
                <p className="text-sm font-medium">{t('How far each person rides (km, one way)')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('The driver pays nothing for that trip. Whoever drives, the others pay for their own km.')}
                </p>
                {carMembers.length < 2 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t('Pick the members below, then fill in their km.')}</p>
                ) : null}
                {carMembers.map((id) => {
                  const rate = parseRupees(carpoolAmountText)
                  const km = Number(kmOf(id).replace(',', '.'))
                  return (
                    <label key={id} className="flex min-h-11 items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm">{people.name(id)}</span>
                      {rate && km > 0 ? <span className="text-xs text-slate-500 tabular-nums">{t('{amount} a trip', { amount: formatINR(Math.round(km * rate)) })}</span> : null}
                      <input
                        inputMode="decimal"
                        aria-label={t('Km for {name}', { name: people.name(id) })}
                        value={kmOf(id)}
                        onChange={(e) => setKmText((m) => ({ ...m, [id]: e.target.value.replace(/[^\d.,]/g, '') }))}
                        placeholder="km"
                        className="h-10 w-20 rounded-lg bg-slate-100 px-2 text-right tabular-nums outline-none focus:ring-2 focus:ring-brand-600 dark:bg-slate-800"
                      />
                    </label>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}
        {existing && usesTolerance ? (
          <Field label={t('Counts as even within (₹)')} hint={t('Small differences inside this amount show as “barabar”.')}>
            <TextInput inputMode="decimal" value={toleranceText} onChange={(e) => setToleranceText(e.target.value)} />
          </Field>
        ) : null}
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
      {existing ? <DangerZone group={existing} /> : null}
    </Page>
  )
}

/** Delete (creator) or leave (everyone else). Money is never touched. */
function DangerZone({ group }: { group: Group }) {
  const { t } = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const me = usePeople().me
  const [confirming, setConfirming] = useState(false)
  const isCreator = me?.id === group.createdBy
  const action = useLedgerMutation(() => (isCreator ? api.deleteGroup(group.id) : api.leaveGroup(group.id)))
  const done = () => {
    toast(isCreator ? t('Group deleted') : t('You left the group'))
    navigate('/groups', { replace: true })
  }
  return (
    <>
      <SectionTitle>{isCreator ? t('Delete group') : t('Leave group')}</SectionTitle>
      <Card className="p-4 text-sm">
        <p className="text-slate-600 dark:text-slate-300">
          {isCreator
            ? t('The group goes away for everyone. Its expenses and payments stay in each person’s balance and passbook, so nobody’s hisaab changes. Repeating bills and car pool rides for it stop.')
            : t('You’ll stop seeing this group. You can leave once you’re settled up in it; your past entries stay as they are.')}
        </p>
        <Button variant="danger" block className="mt-3" onClick={() => setConfirming(true)}>
          <IconTrash size={18} /> {isCreator ? t('Delete “{name}”', { name: group.name }) : t('Leave “{name}”', { name: group.name })}
        </Button>
      </Card>
      <Sheet open={confirming} onClose={() => setConfirming(false)} title={isCreator ? t('Delete this group?') : t('Leave this group?')}>
        <p className="text-slate-600 dark:text-slate-300">
          {isCreator
            ? t('“{name}” will be removed for all {n} members. Balances stay exactly as they are.', { name: group.name, n: group.memberIds.length })
            : t('“{name}” will disappear from your groups.', { name: group.name })}
        </p>
        {action.error ? <p className="mt-3 text-sm text-red-600">{friendlyError(action.error)}</p> : null}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)}>{t('Cancel')}</Button>
          <Button variant="danger" busy={action.isPending} onClick={() => action.mutate(undefined, { onSuccess: done })}>
            {isCreator ? t('Delete') : t('Leave')}
          </Button>
        </div>
      </Sheet>
    </>
  )
}
