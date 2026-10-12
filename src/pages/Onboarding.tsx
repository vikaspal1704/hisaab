import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Button, Field, TextInput } from '../components/ui'
import { keys } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { normalizePhone } from '../lib/phone'
import { isLikelyUpiId } from '../lib/upi'

export function OnboardingPage() {
  const { session, signOut } = useAuth()
  const client = useQueryClient()
  const meta = session?.user.user_metadata ?? {}
  const verifiedPhone = session?.user.phone ? '+' + session.user.phone.replace(/^\+/, '') : ''
  const [name, setName] = useState<string>(meta.full_name ?? meta.name ?? '')
  const [phone, setPhone] = useState(verifiedPhone)
  const [upi, setUpi] = useState('')
  const [errors, setErrors] = useState<{ name?: string; phone?: string; upi?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const e164 = normalizePhone(phone)
    const next = {
      name: name.trim() ? undefined : 'Tell your friends who you are',
      phone: e164 ? undefined : 'Enter a valid mobile number',
      upi: !upi.trim() || isLikelyUpiId(upi) ? undefined : 'Looks like name@bank (e.g. ravi@okaxis)',
    }
    setErrors(next)
    if (next.name || next.phone || next.upi) return
    setBusy(true)
    try {
      await api.claimProfile(name.trim(), e164!, upi.trim() || null)
      await client.invalidateQueries({ queryKey: keys.me })
    } catch (error) {
      setErrors({ form: friendlyError(error) })
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="pt-safe mx-auto flex min-h-dvh max-w-lg flex-col px-6 py-8">
      <h1 className="text-2xl font-bold">Set up your profile</h1>
      <p className="mt-1 text-slate-600 dark:text-slate-300">
        Your friends add you using your mobile number. If someone already added you, your history shows up right away.
      </p>
      <div className="mt-8 space-y-5">
        <Field label="Your name" error={errors.name}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} />
        </Field>
        <Field label="Mobile number" error={errors.phone} hint={verifiedPhone ? 'Verified by OTP' : undefined}>
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
          label="UPI ID (optional)"
          error={errors.upi}
          hint="Lets friends pay you back in one tap from GPay, PhonePe or Paytm."
        >
          <TextInput value={upi} onChange={(e) => setUpi(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="yourname@okaxis" />
        </Field>
      </div>
      {errors.form ? <p className="mt-4 text-sm text-red-600">{errors.form}</p> : null}
      <div className="mt-auto space-y-2 pt-8">
        <Button type="submit" block busy={busy}>Continue</Button>
        <Button variant="ghost" block onClick={signOut}>Use a different account</Button>
      </div>
    </form>
  )
}
