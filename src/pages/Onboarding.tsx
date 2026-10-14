import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Button, Field, TextInput } from '../components/ui'
import { VerifyPhone } from '../components/VerifyPhone'
import { keys } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError, hasErrorCode } from '../lib/errors'
import { clearInvite, pendingInvite } from '../lib/invite'
import { normalizePhone } from '../lib/phone'
import { whatsappVerifyNumber } from '../lib/supabase'
import { isLikelyUpiId } from '../lib/upi'
import { useT } from '../lib/i18n'

export function OnboardingPage() {
  const { session, signOut } = useAuth()
  const { t } = useT()
  const client = useQueryClient()
  const meta = session?.user.user_metadata ?? {}
  const verifiedPhone = session?.user.phone ? '+' + session.user.phone.replace(/^\+/, '') : ''
  const [name, setName] = useState<string>(meta.full_name ?? meta.name ?? '')
  const [phone, setPhone] = useState(verifiedPhone)
  const [upi, setUpi] = useState('')
  const [errors, setErrors] = useState<{ name?: string; phone?: string; upi?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const [invite] = useState(pendingInvite)
  // A number friends already used needs proof; WhatsApp verification gives it.
  const [needsProof, setNeedsProof] = useState<string | null>(null)

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const e164 = normalizePhone(phone)
    const next = {
      name: name.trim() ? undefined : t('Tell your friends who you are'),
      phone: e164 ? undefined : t('Enter a valid mobile number'),
      upi: !upi.trim() || isLikelyUpiId(upi) ? undefined : t('Looks like name@bank (e.g. ravi@okaxis)'),
    }
    setErrors(next)
    if (next.name || next.phone || next.upi) return
    setBusy(true)
    try {
      await api.claimProfile(name.trim(), e164!, upi.trim() || null, invite)
      clearInvite()
      await client.invalidateQueries({ queryKey: keys.me })
    } catch (error) {
      if (whatsappVerifyNumber && hasErrorCode(error, 'phone_needs_invite')) {
        setNeedsProof(e164)
        setErrors({})
      } else {
        setErrors({ form: friendlyError(error) })
      }
      setBusy(false)
    }
  }
  // Verification finishes later; submit with whatever is in the form then.
  const latestSubmit = useRef(submit)
  useEffect(() => {
    latestSubmit.current = submit
  })
  const onVerified = useCallback(() => void latestSubmit.current(), [])

  return (
    <form onSubmit={submit} className="pt-safe mx-auto flex min-h-dvh max-w-lg flex-col px-6 py-8">
      <h1 className="text-2xl font-bold">{t('Set up your profile')}</h1>
      <p className="mt-1 text-slate-600 dark:text-slate-300">
        {t('Your friends add you using your mobile number. If someone already added you, your history shows up right away.')}
      </p>
      {invite ? (
        <p className="mt-3 rounded-2xl bg-brand-50 p-3 text-sm text-brand-800 ring-1 ring-brand-100 dark:bg-brand-800/30 dark:text-brand-100 dark:ring-brand-800">
          🎉 {t('You came from a friend’s invite. Enter the number they saved for you and your hisaab moves in.')}
        </p>
      ) : null}
      <div className="mt-8 space-y-5">
        <Field label={t('Your name')} error={errors.name}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} />
        </Field>
        <Field label={t('Mobile number')} error={errors.phone} hint={verifiedPhone ? t('Verified by OTP') : undefined}>
          <TextInput
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            readOnly={Boolean(verifiedPhone)}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210"
          />
        </Field>
        <Field
          label={t('UPI ID (optional)')}
          error={errors.upi}
          hint={t('Lets friends pay you back in one tap from GPay, PhonePe or Paytm.')}
        >
          <TextInput value={upi} onChange={(e) => setUpi(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="yourname@okaxis" />
        </Field>
      </div>
      {needsProof && normalizePhone(phone) === needsProof ? (
        <div className="mt-6 space-y-2">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('Friends already keep hisaab with this number. Show it’s yours and all of it moves into your account.')}
          </p>
          <VerifyPhone phone={needsProof} onVerified={onVerified} />
        </div>
      ) : null}
      {errors.form ? <p className="mt-4 text-sm text-red-600">{errors.form}</p> : null}
      <div className="mt-auto space-y-2 pt-8">
        <Button type="submit" block busy={busy}>{t('Continue')}</Button>
        <Button variant="ghost" block onClick={signOut}>{t('Use a different account')}</Button>
      </div>
    </form>
  )
}
