import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { Page } from '../components/Page'
import { ContactChecklist } from '../components/PeoplePicker'
import { useToast } from '../components/Toast'
import { Button, Card, Field, inputClass, LoadingView, SectionTitle } from '../components/ui'
import { useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError, InputError } from '../lib/errors'
import { todayISO } from '../lib/format'
import { useT } from '../lib/i18n'
import { parseRupees } from '../lib/money'

const OCCASIONS = ['🎂 Birthday', '🎉 Promotion', '💼 New job', '💍 Anniversary', '🏏 Match won', '✨ Just because']

/** A treat is remembered, never owed: "Rahul gave a birthday treat". */
export function TreatPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const people = usePeople()
  const meId = people.me?.id
  const [giver, setGiver] = useState<string | null>(null)
  const [guests, setGuests] = useState<Set<string>>(() => new Set((params.get('with') ?? '').split(',').filter(Boolean)))
  const [occasion, setOccasion] = useState(OCCASIONS[0])
  const [amountText, setAmountText] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(todayISO())

  const giverId = giver ?? meId ?? ''
  const save = useLedgerMutation(async () => {
    const amount = parseRupees(amountText)
    if (!amount) throw new InputError(t('Enter roughly how much it was'))
    const everyone = new Set([...guests, meId!])
    everyone.delete(giverId)
    if (everyone.size === 0) throw new InputError(t('Pick who was treated'))
    const occasionText = occasion.replace(/^\S+\s/, '')
    return api.saveTreat({
      giver: giverId,
      amount,
      description: description.trim() || t('{occasion} treat', { occasion: occasionText }),
      occasion: occasionText,
      occurredOn: date,
      guests: [...everyone],
      groupId: null,
    })
  })

  if (!meId) return <Page title={t('Treat')} back><LoadingView /></Page>
  const candidates = [meId, ...guests]

  return (
    <Page
      title={t('Log a treat')}
      back
      footer={
        <div className="pb-1">
          {save.error ? <p className="mb-2 text-center text-sm text-red-600">{friendlyError(save.error)}</p> : null}
          <Button
            block
            busy={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: (id) => {
                  toast(t('Treat saved 🎁'))
                  navigate(`/e/${id}`, { replace: true })
                },
              })
            }
          >
            {t('Save treat')}
          </Button>
        </div>
      }
    >
      <Card className="mt-2 p-4 text-sm text-slate-600 dark:text-slate-300">
        {t('Treats don’t create any debt. Hisaab just remembers who treated whom, so the next birthday is easy to plan.')}
      </Card>

      <SectionTitle>{t('Occasion')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {OCCASIONS.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={occasion === o}
            onClick={() => setOccasion(o)}
            className={`min-h-10 rounded-full px-3 text-sm ring-1 ${occasion === o ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-700'}`}
          >
            {t(o)}
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Field label={t('About how much (₹)')}>
          <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} className={inputClass} />
        </Field>
        <Field label={t('Date')}>
          <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} className={inputClass} />
        </Field>
      </div>
      <div className="mt-4">
        <Field label={t('Where / what (optional)')}>
          <input value={description} maxLength={100} onChange={(e) => setDescription(e.target.value)} placeholder={t('e.g. Dinner at Toit')} className={inputClass} />
        </Field>
      </div>

      <SectionTitle>{t('Who gave the treat?')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {candidates.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={giverId === id}
            onClick={() => setGiver(id)}
            className={`flex min-h-10 items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-medium ring-1 ${giverId === id ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-700'}`}
          >
            <Avatar id={id} name={people.name(id, { you: false })} size={28} /> {people.name(id)}
          </button>
        ))}
      </div>

      <SectionTitle>{t('Who was there?')}</SectionTitle>
      <ContactChecklist
        selected={guests}
        onToggle={(id) => {
          const next = new Set(guests)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          setGuests(next)
        }}
      />
    </Page>
  )
}
