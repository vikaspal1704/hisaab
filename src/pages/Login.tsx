import { useState } from 'react'
import { IconCheck } from '../components/icons'
import { Button, Field, TextInput } from '../components/ui'
import { friendlyError } from '../lib/errors'
import { normalizePhone } from '../lib/phone'
import { isNativeApp, nativeGoogleSignIn } from '../lib/native'
import { phoneOtpEnabled, supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'

const redirectTo = () => window.location.origin + window.location.pathname

export function LoginPage() {
  const { t, lang, setLang } = useT()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const google = async () => {
    setBusy(true)
    setError(null)
    if (isNativeApp()) {
      try {
        await nativeGoogleSignIn()
      } catch (e) {
        setError(friendlyError(e))
      }
      setBusy(false)
      return
    }
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } })
    if (error) {
      setError(friendlyError(error))
      setBusy(false)
    }
  }

  const features = [
    t('Aaj maine diya, kal tu de — Hisaab remembers whose baari it is'),
    t('Friends can check without installing anything'),
    t('Couples can settle together'),
  ]
  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Brand panel (laptop) / header (phone) */}
      <section className="pt-safe relative overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-brand-900 px-6 pb-10 text-white lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-brand-400/20 blur-3xl" />
        <div className="relative flex items-center justify-between pt-6 lg:pt-0">
          <span className="flex items-center gap-2.5">
            <img src="./icon.svg" alt="" className="h-10 w-10 rounded-xl ring-1 ring-white/20" />
            <span className="text-xl font-bold tracking-tight">Hisaab</span>
          </span>
          <button
            type="button"
            onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
            className="min-h-9 rounded-full px-3 text-sm ring-1 ring-white/30 transition-colors hover:bg-white/10"
          >
            {lang === 'hi' ? 'English' : 'Hinglish'}
          </button>
        </div>
        <div className="relative mt-10 max-w-lg lg:mt-0">
          <h1 className="text-3xl leading-tight font-bold tracking-tight lg:text-5xl">{t('Keep the books with your friends.')}</h1>
          <p className="mt-3 text-lg text-brand-100 lg:text-xl">
            {t('No more splitting every bill — take turns paying, and Hisaab keeps it fair.')}
          </p>
          <ul className="mt-6 space-y-2.5">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-brand-50">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15"><IconCheck size={14} /></span>
                {f}
              </li>
            ))}
          </ul>
        </div>
        {/* A glimpse of the app (laptop only) */}
        <div aria-hidden className="relative mt-10 hidden max-w-md rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur lg:block">
          <p className="text-sm text-brand-100">{t('Overall, you are owed {amount}', { amount: '₹1,240' })}</p>
          <div className="mt-3 space-y-2 text-sm">
            {[
              ['Rahul', t('{name}’s baari', { name: 'Rahul' }), '₹915'],
              ['Priya', t('Your baari with {name}', { name: 'Priya' }), '₹340'],
              ['Goa trip', t('All square'), '—'],
            ].map(([who, what, amount]) => (
              <div key={who} className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold">{who[0]}</span>
                <span className="flex-1">{what}</span>
                <span className="font-semibold tabular-nums">{amount}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sign in */}
      <section className="pb-safe flex flex-1 items-start justify-center px-6 py-10 lg:items-center lg:px-14">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold tracking-tight">{t('Sign in')}</h2>
          <p className="mt-1 text-slate-600 dark:text-slate-400">{t('Free, no ads. Your friends don’t need the app to start.')}</p>
          <div className="mt-8 space-y-3">
            {phoneOtpEnabled ? <PhoneLogin /> : null}
            <Button variant="secondary" block busy={busy} onClick={google}>
              <GoogleMark /> {t('Continue with Google')}
            </Button>
            {error ? <p className="text-center text-sm text-red-600">{error}</p> : null}
          </div>
          <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
            {t('Friends find you by your phone number, which you add next.')}
          </p>
          <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
            {t('Made by')}{' '}
            <a href="https://vikaspal.is-a.dev/" className="font-medium underline underline-offset-2 hover:text-slate-700 dark:hover:text-slate-200">
              Vikas Pal
            </a>
          </p>
        </div>
      </section>
    </div>
  )
}

function PhoneLogin() {
  const { t } = useT()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async () => {
    const e164 = normalizePhone(phone)
    if (!e164) return setError(t('Enter a valid mobile number'))
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({ phone: e164 })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else setSentTo(e164)
  }

  const verify = async () => {
    if (!sentTo) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ phone: sentTo, token: code.trim(), type: 'sms' })
    setBusy(false)
    if (error) setError(t('That code didn’t work. Check it and try again.'))
  }

  return (
    <div className="space-y-3">
      {sentTo ? (
        <Field label={t('Code sent to {phone}', { phone: sentTo })} error={error}>
          <TextInput inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('6-digit code')} />
        </Field>
      ) : (
        <Field label={t('Mobile number')} error={error}>
          <TextInput type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
        </Field>
      )}
      <Button block busy={busy} onClick={sentTo ? verify : send}>
        {sentTo ? t('Verify') : t('Send OTP')}
      </Button>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3A12 12 0 1 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  )
}
