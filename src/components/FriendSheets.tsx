import { useEffect, useState } from 'react'
import { useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import type { Style } from '../lib/baari'
import { friendlyError, InputError } from '../lib/errors'
import { todayISO } from '../lib/format'
import { useT } from '../lib/i18n'
import { formatINR, parseRupees, toRupeeInput, type Paise } from '../lib/money'
import { nudgeMessage, type Tone } from '../lib/nudge'
import { formatPhone, normalizePhone } from '../lib/phone'
import { inviteText, sharedUrl, whatsappLink } from '../lib/share'
import type { ContactPrefs } from '../lib/types'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { Button, Field, inputClass, Segmented, TextInput } from './ui'


/** "I gave Rahul ₹200" / "Rahul gave me ₹200" — a loan, not a shared bill. */
export function LentSheet({ open, onClose, personId: fixedPerson }: { open: boolean; onClose: () => void; personId?: string }) {
  const { t } = useT()
  const toast = useToast()
  const people = usePeople()
  const contacts = people.list.filter((p) => p.is_contact && !p.is_me).sort((a, b) => a.display_name.localeCompare(b.display_name))
  const [chosen, setChosen] = useState<string>('')
  const personId = fixedPerson ?? (chosen || contacts[0]?.id || '')
  const [direction, setDirection] = useState<'gave' | 'took'>('gave')
  const [amountText, setAmountText] = useState('')
  const [note, setNote] = useState('')
  const name = personId ? people.name(personId) : '…'
  const save = useLedgerMutation(async () => {
    const amount = parseRupees(amountText)
    const me = people.me?.id
    if (!amount) throw new InputError(t('Enter an amount'))
    if (!me) throw new InputError(t('Finish setting up your profile first.'))
    if (!personId) throw new InputError(t('Add a friend first'))
    const giver = direction === 'gave' ? me : personId
    const taker = direction === 'gave' ? personId : me
    return api.saveExpense({
      entryId: null,
      description: note.trim() || (direction === 'gave' ? t('Lent to {name}', { name }) : t('Borrowed from {name}', { name })),
      amount,
      occurredOn: todayISO(),
      groupId: null,
      splitMode: 'exact',
      parts: [
        { person_id: giver, paid: amount, owed: 0, shares: null },
        { person_id: taker, paid: 0, owed: amount, shares: null },
      ],
      expectedVersion: null,
    })
  })
  return (
    <Sheet open={open} onClose={onClose} title={t('Lent or borrowed')}>
      <div className="space-y-4">
        {fixedPerson ? null : (
          <Field label={t('Friend')}>
            <select value={personId} onChange={(e) => setChosen(e.target.value)} className={inputClass}>
              {contacts.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
          </Field>
        )}
        <Segmented
          label={t('Direction')}
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'gave', label: t('I gave {name}', { name }) },
            { value: 'took', label: t('{name} gave me', { name }) },
          ]}
        />
        <Field label={t('Amount')}>
          <TextInput inputMode="decimal" placeholder="₹200" value={amountText} onChange={(e) => setAmountText(e.target.value)} autoFocus />
        </Field>
        <Field label={t('For (optional)')}>
          <TextInput placeholder={t('e.g. petrol, recharge, auto')} value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {save.error ? <p className="text-sm text-red-600">{friendlyError(save.error)}</p> : null}
        <Button
          block
          busy={save.isPending}
          onClick={() =>
            save.mutate(undefined, {
              onSuccess: () => {
                toast(t('Saved'))
                setAmountText('')
                setNote('')
                onClose()
              },
            })
          }
        >
          {t('Save')}
        </Button>
      </div>
    </Sheet>
  )
}

/** "Chhod do": let go of (part of) what a friend owes me. */
export function ForgiveSheet({ open, onClose, personId, owed }: { open: boolean; onClose: () => void; personId: string; owed: Paise }) {
  const { t } = useT()
  const toast = useToast()
  const people = usePeople()
  const [amountText, setAmountText] = useState(toRupeeInput(Math.max(owed, 1)))
  const save = useLedgerMutation(async () => {
    const amount = parseRupees(amountText)
    if (!amount) throw new InputError(t('Enter an amount'))
    return api.forgive(personId, amount, null)
  })
  return (
    <Sheet open={open} onClose={onClose} title={t('Chhod do 🙏')}>
      <p className="text-slate-600 dark:text-slate-300">
        {t('Let go of what {name} owes you. It stays in the passbook as a gift, so the books stay honest.', { name: people.name(personId) })}
      </p>
      <div className="mt-4 space-y-4">
        <Field label={t('Amount to let go (up to {amount})', { amount: formatINR(owed) })}>
          <TextInput inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </Field>
        {save.error ? <p className="text-sm text-red-600">{friendlyError(save.error)}</p> : null}
        <Button
          block
          busy={save.isPending}
          onClick={() =>
            save.mutate(undefined, {
              onSuccess: () => {
                toast(t('Done. Dil bada hai 💛'))
                onClose()
              },
            })
          }
        >
          {t('Let it go')}
        </Button>
      </div>
    </Sheet>
  )
}

/** A friendly WhatsApp reminder, optionally with a link to our passbook. */
export function NudgeSheet({ open, onClose, personId, amount }: { open: boolean; onClose: () => void; personId: string; amount: Paise }) {
  const { t } = useT()
  const people = usePeople()
  const person = people.byId.get(personId)
  const [tone, setTone] = useState<Tone>('baari')
  const [withLink, setWithLink] = useState(true)
  const [token, setToken] = useState<string | null>(null)
  const nudged = useLedgerMutation(() => api.markNudged(personId))
  const link = useLedgerMutation(() => api.createShareLink(personId))
  const { mutate: createLink, isPending: creatingLink } = link

  // Create (or reuse) the link up front so it's ready before "Send" is tapped.
  useEffect(() => {
    if (open && withLink && !token && !creatingLink) createLink(undefined, { onSuccess: setToken })
  }, [open, withLink, token, creatingLink, createLink])

  if (!person) return null
  const message = nudgeMessage({
    name: person.display_name,
    amount,
    tone,
    myUpi: people.me?.upi_id,
    link: withLink && token ? sharedUrl(token) : null,
  })
  const waiting = withLink && !token

  return (
    <Sheet open={open} onClose={onClose} title={t('Remind {name}', { name: person.display_name })}>
      <div className="space-y-4">
        <Segmented
          label={t('Tone')}
          value={tone}
          onChange={setTone}
          options={[
            { value: 'baari', label: t('Baari 😄') },
            { value: 'friendly', label: t('Friendly') },
            { value: 'direct', label: t('Direct') },
          ]}
        />
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={withLink}
            onChange={(e) => setWithLink(e.target.checked)}
            className="h-5 w-5 accent-brand-700"
          />
          <span className="text-sm">{t('Include a link to our hisaab (no app needed)')}</span>
        </label>
        <p className="rounded-2xl bg-slate-100 p-3 text-sm whitespace-pre-line [overflow-wrap:anywhere] dark:bg-slate-800">{message}</p>
        <a
          href={whatsappLink(person.phone, message)}
          target="_blank"
          rel="noreferrer"
          aria-disabled={waiting}
          onClick={(e) => {
            if (waiting) return e.preventDefault()
            nudged.mutate()
            onClose()
          }}
          className={`flex min-h-12 items-center justify-center rounded-xl bg-[#25D366] font-semibold text-white ${waiting ? 'opacity-60' : ''}`}
        >
          {waiting ? t('Preparing link…') : t('Send on WhatsApp')}
        </a>
        {link.error ? <p className="text-sm text-red-600">{friendlyError(link.error)}</p> : null}
      </div>
    </Sheet>
  )
}

/** How I deal with this friend: baari or exact, what counts as even, and when to remind. */
export function FriendSettingsSheet({
  open,
  onClose,
  personId,
  prefs,
  currentName,
}: {
  open: boolean
  onClose: () => void
  personId: string
  prefs: ContactPrefs
  currentName: string
}) {
  const { t } = useT()
  const toast = useToast()
  const [name, setName] = useState(currentName)
  const [style, setStyle] = useState<Style>(prefs.style)
  const [tolerance, setTolerance] = useState(toRupeeInput(prefs.tolerance))
  const [remindAbove, setRemindAbove] = useState(toRupeeInput(prefs.remind_above))
  const [remindAfter, setRemindAfter] = useState(String(prefs.remind_after_days))
  const save = useLedgerMutation(async () => {
    const tol = tolerance.trim() === '0' || tolerance.trim() === '' ? 0 : parseRupees(tolerance)
    const above = parseRupees(remindAbove)
    const days = Number(remindAfter)
    if (tol === null || !above || !Number.isInteger(days) || days < 1 || days > 365) {
      throw new InputError(t('Check the amounts and days'))
    }
    if (name.trim() && name.trim() !== currentName) await api.setNickname(personId, name.trim())
    await api.setContactPrefs(personId, { style, tolerance: tol, remind_above: above, remind_after_days: days })
  })
  return (
    <Sheet open={open} onClose={onClose} title={t('Settings')}>
      <div className="space-y-4">
        <Field label={t('Name (only you see this)')}>
          <TextInput value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">{t('How you two do it')}</p>
          <Segmented
            label={t('Style')}
            value={style}
            onChange={setStyle}
            options={[
              { value: 'baari', label: t('Baari (take turns)') },
              { value: 'exact', label: t('Exact splits') },
            ]}
          />
          <p className="mt-1 text-sm text-slate-500">
            {style === 'baari'
              ? t('Shows whose turn it is to pay. Small differences count as even.')
              : t('Shows exactly who owes what, down to the rupee.')}
          </p>
        </div>
        {style === 'baari' ? (
          <Field label={t('Counts as even within (₹)')}>
            <input inputMode="decimal" value={tolerance} onChange={(e) => setTolerance(e.target.value)} className={inputClass} />
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Remind above (₹)')}>
            <input inputMode="decimal" value={remindAbove} onChange={(e) => setRemindAbove(e.target.value)} className={inputClass} />
          </Field>
          <Field label={t('After (days)')}>
            <input inputMode="numeric" value={remindAfter} onChange={(e) => setRemindAfter(e.target.value)} className={inputClass} />
          </Field>
        </div>
        {save.error ? <p className="text-sm text-red-600">{friendlyError(save.error)}</p> : null}
        <Button
          block
          busy={save.isPending}
          onClick={() =>
            save.mutate(undefined, {
              onSuccess: () => {
                toast(t('Saved'))
                onClose()
              },
            })
          }
        >
          {t('Save')}
        </Button>
      </div>
    </Sheet>
  )
}

/**
 * Gives a friend added by name their number. If someone already has that
 * number in Hisaab, the two become one and `onDone` gets the surviving id.
 */
export function AddNumberSheet({
  open,
  onClose,
  personId,
  onDone,
}: {
  open: boolean
  onClose: () => void
  personId: string
  onDone: (personId: string) => void
}) {
  const { t } = useT()
  const toast = useToast()
  const people = usePeople()
  const [phone, setPhone] = useState('')
  const save = useLedgerMutation(async () => {
    const e164 = normalizePhone(phone)
    if (!e164) throw new InputError(t('Enter a valid mobile number'))
    return api.setContactPhone(personId, e164)
  })
  const name = people.name(personId)
  return (
    <Sheet open={open} onClose={onClose} title={t('Add {name}’s number', { name })}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(undefined, {
            onSuccess: (id) => {
              toast(t('Number added'))
              onDone(id)
            },
          })
        }}
      >
        <Field
          label={t('Mobile number')}
          hint={t('If {name} is already on Hisaab (or in someone’s hisaab) with this number, everything joins up.', { name })}
        >
          <TextInput type="tel" inputMode="tel" autoComplete="tel" autoFocus placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {save.error ? <p className="text-sm text-red-600">{friendlyError(save.error)}</p> : null}
        <Button block type="submit" busy={save.isPending}>
          {t('Save number')}
        </Button>
      </form>
    </Sheet>
  )
}

/** Share our passbook with a friend who doesn't have the app. */
export function ShareSheet({ open, onClose, personId }: { open: boolean; onClose: () => void; personId: string }) {
  const { t } = useT()
  const toast = useToast()
  const people = usePeople()
  const person = people.byId.get(personId)
  const [token, setToken] = useState<string | null>(null)
  const create = useLedgerMutation(() => api.createShareLink(personId))
  const revoke = useLedgerMutation(() => api.revokeShareLink(personId))
  if (!person) return null
  const url = token ? sharedUrl(token) : null
  const text = url
    ? t('Hey {name}, here’s our hisaab — check it and tap 👍 if it looks right: {url}', { name: person.display_name.split(' ')[0], url })
    : ''
  return (
    <Sheet open={open} onClose={onClose} title={t('Share our hisaab')}>
      <p className="text-slate-600 dark:text-slate-300">
        {t('{name} can open this link without the app, see every entry between you two, and confirm or question them.', {
          name: person.display_name,
        })}
      </p>
      <div className="mt-4 space-y-2">
        {url ? (
          <>
            <p className="rounded-xl bg-slate-100 p-3 text-xs break-all dark:bg-slate-800">{url}</p>
            <a
              href={whatsappLink(person.phone, text)}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-12 items-center justify-center rounded-xl bg-[#25D366] font-semibold text-white"
            >
              {t('Send on WhatsApp')}
            </a>
            <Button
              variant="ghost"
              block
              busy={revoke.isPending}
              onClick={() =>
                revoke.mutate(undefined, {
                  onSuccess: () => {
                    setToken(null)
                    toast(t('Link turned off'))
                  },
                })
              }
            >
              {t('Turn off this link')}
            </Button>
          </>
        ) : (
          <Button block busy={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: setToken })}>
            {t('Create link')}
          </Button>
        )}
        {create.error ? <p className="text-sm text-red-600">{friendlyError(create.error)}</p> : null}
      </div>
    </Sheet>
  )
}

/**
 * Invite a friend who isn't on Hisaab yet. The message carries our passbook
 * link: they can see it straight away, and joining from it links everything
 * recorded against their number to their new account.
 */
export function InviteSheet({ open, onClose, personId }: { open: boolean; onClose: () => void; personId: string }) {
  const { t } = useT()
  const people = usePeople()
  const person = people.byId.get(personId)
  const [token, setToken] = useState<string | null>(null)
  const link = useLedgerMutation(() => api.createShareLink(personId))
  const { mutate: createLink, isPending: creatingLink, isError } = link

  useEffect(() => {
    if (open && !token && !creatingLink && !isError) createLink(undefined, { onSuccess: setToken })
  }, [open, token, creatingLink, isError, createLink])

  if (!person) return null
  const message = token ? inviteText(person.display_name.split(' ')[0], sharedUrl(token), person.phone !== null) : ''
  return (
    <Sheet open={open} onClose={onClose} title={t('Invite {name}', { name: person.display_name })}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {person.phone
            ? t('They can see your hisaab from the link without signing up. When they join with {phone}, everything you’ve added shows up in their account.', {
                phone: formatPhone(person.phone),
              })
            : t('You don’t have their number, so pick their chat in WhatsApp. They can see your hisaab from the link, and when they join from it, everything you’ve added shows up in their account.')}
        </p>
        {token ? <p className="rounded-2xl bg-slate-100 p-3 text-sm whitespace-pre-line [overflow-wrap:anywhere] dark:bg-slate-800">{message}</p> : null}
        <a
          href={token ? whatsappLink(person.phone, message) : undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!token}
          onClick={(e) => (token ? onClose() : e.preventDefault())}
          className={`flex min-h-12 items-center justify-center rounded-xl bg-[#25D366] font-semibold text-white ${token ? '' : 'opacity-60'}`}
        >
          {token ? t('Send on WhatsApp') : t('Preparing link…')}
        </a>
        {link.error ? <p className="text-sm text-red-600">{friendlyError(link.error)}</p> : null}
      </div>
    </Sheet>
  )
}
