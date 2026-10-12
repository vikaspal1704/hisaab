import { useState } from 'react'
import { Button, Field, TextInput } from '../components/ui'
import { friendlyError } from '../lib/errors'
import { normalizePhone } from '../lib/phone'
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
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } })
    if (error) {
      setError(friendlyError(error))
      setBusy(false)
    }
  }

  return (
    <div className="pt-safe mx-auto flex min-h-dvh max-w-lg flex-col px-6">
      <div className="flex flex-1 flex-col justify-center py-10">
        <div className="flex items-center justify-between">
          <img src="./icon.svg" alt="" className="h-16 w-16" />
          <button type="button" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')} className="min-h-9 rounded-full px-3 text-sm ring-1 ring-slate-300 dark:ring-slate-700">
            {lang === 'hi' ? 'English' : 'Hinglish'}
          </button>
        </div>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">Hisaab</h1>
        <p className="mt-2 text-lg text-slate-600 dark:text-slate-300">
          {t('Keep the books with your friends. No more splitting every bill — take turns paying, and Hisaab keeps it fair.')}
        </p>
        <ul className="mt-6 space-y-2 text-slate-600 dark:text-slate-300">
          <li>✓ {t('Aaj maine diya, kal tu de — Hisaab remembers whose baari it is')}</li>
          <li>✓ {t('Friends can check without installing anything')}</li>
          <li>✓ {t('Couples can settle together')}</li>
        </ul>
      </div>
      <div className="pb-safe space-y-3 pb-6">
        {phoneOtpEnabled ? <PhoneLogin /> : null}
        <Button variant={phoneOtpEnabled ? 'secondary' : 'primary'} block busy={busy} onClick={google}>
          <GoogleMark /> {t('Continue with Google')}
        </Button>
        {error ? <p className="text-center text-sm text-red-600">{error}</p> : null}
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          {t('Friends find you by your phone number, which you add next.')}
        </p>
      </div>
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
