import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { IconCopy, IconSwap, IconWhatsApp } from '../components/icons'
import { Page } from '../components/Page'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { Button, Card, ErrorView, Field, inputClass, LoadingView, Segmented, SectionTitle } from '../components/ui'
import { useBalances, useHouseholds, useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError, InputError } from '../lib/errors'
import { todayISO } from '../lib/format'
import { formatINR, parseRupees, toRupeeInput } from '../lib/money'
import { planHouseholdPayment, type Allocation, type PaymentPlan } from '../lib/settle'
import { copyText, reminderText, whatsappLink } from '../lib/share'
import type { PaymentMethod, Person } from '../lib/types'
import { upiPayLink } from '../lib/upi'

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'other', label: 'Other' },
]

export function SettleUpPage() {
  const { kind, id = '' } = useParams()
  const people = usePeople()
  const balances = useBalances()
  const households = useHouseholds()

  if (people.isPending || balances.isPending || households.isPending || !people.me) {
    return <Page title="Settle up" back><LoadingView /></Page>
  }
  if (kind === 'household') {
    const household = households.data?.find((h) => h.id === id)
    if (!household) return <Page title="Settle up" back><ErrorView message="Pair not found." /></Page>
    const members = household.memberIds.filter((m) => m !== people.me!.id)
    return <SettleForm key={formKey(members, balances.net)} me={people.me} title={household.name} members={members} />
  }
  if (!people.byId.get(id)) return <Page title="Settle up" back><ErrorView message="Person not found." /></Page>
  return <SettleForm key={formKey([id], balances.net)} me={people.me} title={people.name(id)} members={[id]} />
}

/** Restarts the form when a balance changes underneath it (e.g. a friend adds an entry meanwhile). */
const formKey = (members: string[], net: (id: string) => number) => members.map((m) => `${m}:${net(m)}`).join('|')

/**
 * One form for both cases: settling with a single friend (members = [id]) or
 * with a pair/household together (members = everyone in it).
 */
function SettleForm({ me, title, members }: { me: Person; title: string; members: string[] }) {
  const navigate = useNavigate()
  const toast = useToast()
  const people = usePeople()
  const balances = useBalances()
  const isHousehold = members.length > 1

  const memberBalances = useMemo(() => Object.fromEntries(members.map((m) => [m, balances.net(m)])), [members, balances])
  const combined = members.reduce((s, m) => s + memberBalances[m], 0)

  const [iPay, setIPay] = useState(combined <= 0)
  const defaultActor = () =>
    [...members].sort((a, b) => (iPay ? memberBalances[a] - memberBalances[b] : memberBalances[b] - memberBalances[a]))[0]
  const [actor, setActor] = useState(defaultActor)
  const [amountText, setAmountText] = useState(combined !== 0 ? toRupeeInput(Math.abs(combined)) : '')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const counterpart = people.byId.get(actor)
  const receiverUpi = iPay ? counterpart?.upi_id : me.upi_id
  const [method, setMethod] = useState<PaymentMethod>(receiverUpi ? 'upi' : 'cash')
  const [onBehalf, setOnBehalf] = useState<{ personId: string; amountText: string } | null>(null)
  const [confirmingUpi, setConfirmingUpi] = useState(false)

  const amount = parseRupees(amountText)

  const plan = useMemo((): PaymentPlan | { error: string } => {
    if (!amount) return { error: 'Enter an amount' }
    const from = iPay ? me.id : actor
    const to = iPay ? actor : me.id
    if (isHousehold) {
      return planHouseholdPayment({ single: me.id, actor, members, balances: memberBalances, amount, payer: iPay ? 'single' : 'household' })
    }
    if (!onBehalf) return { from, to, amount, allocations: [{ debtor: from, creditor: to, amount }] }
    const covered = parseRupees(onBehalf.amountText)
    if (!covered) return { error: 'Enter how much of their share this covers' }
    if (covered > amount) return { error: 'Their share can’t be more than the payment' }
    const allocations: Allocation[] = [
      { debtor: onBehalf.personId, creditor: to, amount: covered },
      { debtor: from, creditor: onBehalf.personId, amount: covered },
    ]
    if (amount > covered) allocations.unshift({ debtor: from, creditor: to, amount: amount - covered })
    return { from, to, amount, allocations }
  }, [amount, iPay, me.id, actor, isHousehold, members, memberBalances, onBehalf])

  const save = useLedgerMutation(async () => {
    if ('error' in plan) throw new InputError(plan.error)
    return api.savePayment({
      entryId: null,
      from: plan.from,
      to: plan.to,
      amount: plan.amount,
      occurredOn: date,
      method,
      note: note.trim() || null,
      allocations: plan.allocations,
      groupId: null,
      expectedVersion: null,
    })
  })

  // mutateAsync rather than mutate callbacks: saving changes the balance this
  // form is keyed on, and per-call callbacks are dropped if the form remounts.
  const record = async () => {
    try {
      await save.mutateAsync()
    } catch {
      return // shown via save.error
    }
    setConfirmingUpi(false)
    toast('Payment recorded')
    navigate(-1)
  }

  const swap = () => {
    setIPay(!iPay)
    setOnBehalf(null)
  }

  const counterpartName = people.name(actor)
  const planError = 'error' in plan ? plan.error : null
  const canUpi = iPay && method === 'upi' && Boolean(counterpart?.upi_id) && amount && !planError

  return (
    <Page
      title={`Settle up · ${title}`}
      back
      footer={
        <div className="space-y-2 pb-1">
          {save.error ? <p className="text-center text-sm text-red-600">{friendlyError(save.error)}</p> : null}
          {canUpi ? (
            <>
              <a
                href={upiPayLink({ upiId: counterpart!.upi_id!, name: counterpartName, amount: amount!, note: 'Hisaab settle up' })}
                onClick={() => setTimeout(() => setConfirmingUpi(true), 600)}
                className="flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-700 font-semibold text-white active:bg-brand-800"
              >
                Pay {formatINR(amount!)} with a UPI app
              </a>
              <button type="button" onClick={record} className="min-h-10 w-full text-sm font-medium text-slate-600 dark:text-slate-300">
                Already paid? Just record it
              </button>
            </>
          ) : (
            <Button block busy={save.isPending} disabled={Boolean(planError)} onClick={record}>
              {planError ?? (iPay ? `Record ${formatINR(amount!)} paid to ${counterpartName}` : `Record ${formatINR(amount!)} received`)}
            </Button>
          )}
        </div>
      }
    >
      {/* Direction */}
      <Card className="mt-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <PartyChip id={iPay ? me.id : actor} name={iPay ? 'You' : counterpartName} avatarName={iPay ? me.display_name : counterpartName} />
          <div className="flex flex-col items-center text-xs text-slate-500">
            <span>pays</span>
            <span aria-hidden>→</span>
          </div>
          <PartyChip id={iPay ? actor : me.id} name={iPay ? counterpartName : 'You'} avatarName={iPay ? counterpartName : me.display_name} />
        </div>
        <button type="button" onClick={swap} className="mx-auto mt-3 flex min-h-9 items-center gap-1 text-sm font-semibold text-brand-700 dark:text-brand-500">
          <IconSwap size={16} /> Switch direction
        </button>
        <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
          {combined === 0
            ? 'You’re all square right now.'
            : combined > 0
              ? `${title} ${isHousehold ? 'owe' : 'owes'} you ${formatINR(combined)}${isHousehold ? ' together' : ''}.`
              : `You owe ${title} ${formatINR(-combined)}${isHousehold ? ' together' : ''}.`}
        </p>
      </Card>

      {isHousehold ? (
        <>
          <SectionTitle>{iPay ? 'Who are you paying?' : 'Who is paying?'}</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={actor === m}
                onClick={() => setActor(m)}
                className={`flex min-h-10 items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-medium ring-1 ${
                  actor === m ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-700'
                }`}
              >
                <Avatar id={m} name={people.name(m)} size={28} /> {people.name(m)}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div className="mt-5 space-y-4">
        <Field label="Amount">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-lg text-slate-400">₹</span>
            <input
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value.replace(/[^\d.,]/g, ''))}
              className={`${inputClass} pl-8 text-xl font-semibold tabular-nums`}
              aria-label="Amount"
            />
          </div>
        </Field>
        <Segmented label="Payment method" value={method} onChange={setMethod} options={METHODS} />
        {iPay && method === 'upi' && !counterpart?.upi_id ? (
          <p className="text-sm text-slate-500">{counterpartName} hasn’t added a UPI ID. Pay them your usual way, then record it here.</p>
        ) : null}
        {iPay && method === 'upi' && counterpart?.upi_id ? (
          <button
            type="button"
            onClick={async () => toast((await copyText(counterpart.upi_id!)) ? 'UPI ID copied' : counterpart.upi_id!)}
            className="flex min-h-10 items-center gap-2 text-sm text-slate-600 dark:text-slate-300"
          >
            <IconCopy size={16} /> {counterpart.upi_id}
          </button>
        ) : null}
        {!iPay && combined > 0 && counterpart ? (
          <a
            href={whatsappLink(counterpart.phone, reminderText(counterpartName, combined, me.upi_id))}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-10 items-center gap-2 text-sm font-semibold text-[#128C7E] dark:text-[#25D366]"
          >
            <IconWhatsApp size={18} /> Ask {counterpartName} on WhatsApp
          </a>
        ) : null}
      </div>

      {isHousehold && !planError ? <HouseholdPreview plan={plan as PaymentPlan} meId={me.id} name={people.name} /> : null}
      {!isHousehold ? (
        <OnBehalf
          value={onBehalf}
          onChange={setOnBehalf}
          payerName={iPay ? 'you' : counterpartName}
          receiverName={iPay ? counterpartName : 'you'}
          exclude={[me.id, actor]}
        />
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} className={inputClass} />
        </Field>
        <Field label="Note (optional)">
          <input value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Goa trip" className={inputClass} />
        </Field>
      </div>

      <Sheet open={confirmingUpi} onClose={() => setConfirmingUpi(false)} title="Did the payment go through?">
        <p className="text-slate-600 dark:text-slate-300">
          Only record it if your UPI app showed the payment of {amount ? formatINR(amount) : ''} to {counterpartName} as successful.
        </p>
        <div className="mt-5 space-y-2">
          <Button block busy={save.isPending} onClick={record}>Yes, record it</Button>
          <Button block variant="secondary" onClick={() => setConfirmingUpi(false)}>No, it didn’t go through</Button>
        </div>
      </Sheet>
    </Page>
  )
}

function PartyChip({ id, name, avatarName }: { id: string; name: string; avatarName: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
      <Avatar id={id} name={avatarName} size={48} />
      <span className="max-w-full truncate text-sm font-semibold">{name}</span>
    </span>
  )
}

/** Explains exactly what a household settlement will do to each balance. */
function HouseholdPreview({ plan, meId, name }: { plan: PaymentPlan; meId: string; name: (id: string) => string }) {
  const withMe = plan.allocations.filter((a) => a.debtor === meId || a.creditor === meId)
  const internal = plan.allocations.filter((a) => a.debtor !== meId && a.creditor !== meId)
  return (
    <>
      <SectionTitle>What this does</SectionTitle>
      <Card className="space-y-2 p-4 text-sm">
        {withMe.map((a, i) => (
          <p key={i}>
            ✓ Clears {formatINR(a.amount)} {a.debtor === meId ? `you owed ${name(a.creditor)}` : `${name(a.debtor)} owed you`}
          </p>
        ))}
        {internal.map((a, i) => (
          <p key={`i${i}`} className="text-slate-500 dark:text-slate-400">
            ↔ {name(a.creditor)} will owe {name(a.debtor)} {formatINR(a.amount)} between themselves
          </p>
        ))}
      </Card>
    </>
  )
}

/** Optional: this payment also covers someone else's share (e.g. a partner or roommate). */
function OnBehalf({
  value,
  onChange,
  payerName,
  receiverName,
  exclude,
}: {
  value: { personId: string; amountText: string } | null
  onChange: (v: { personId: string; amountText: string } | null) => void
  payerName: string
  receiverName: string
  exclude: string[]
}) {
  const people = usePeople()
  const options = people.list.filter((p) => p.is_contact && !exclude.includes(p.id))
  if (!value) {
    if (options.length === 0) return null
    return (
      <button type="button" onClick={() => onChange({ personId: options[0].id, amountText: '' })} className="mt-4 min-h-10 text-sm font-semibold text-brand-700 dark:text-brand-500">
        + Also covers someone else’s share
      </button>
    )
  }
  return (
    <Card className="mt-5 space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Also covering for</p>
        <button type="button" onClick={() => onChange(null)} className="text-sm text-slate-500">Remove</button>
      </div>
      <select
        aria-label="Covering for"
        value={value.personId}
        onChange={(e) => onChange({ ...value, personId: e.target.value })}
        className={inputClass}
      >
        {options.map((p) => (
          <option key={p.id} value={p.id}>{p.display_name}</option>
        ))}
      </select>
      <input
        inputMode="decimal"
        placeholder="Their share, e.g. 300"
        aria-label="Their share"
        value={value.amountText}
        onChange={(e) => onChange({ ...value, amountText: e.target.value })}
        className={inputClass}
      />
      <p className="text-xs text-slate-500 dark:text-slate-400">
        This clears what {people.name(value.personId)} owes {receiverName}, and {people.name(value.personId)} will owe {payerName} instead.
      </p>
    </Card>
  )
}

