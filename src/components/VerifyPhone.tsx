import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { IconWhatsApp } from './icons'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { useT } from '../lib/i18n'
import { formatPhone } from '../lib/phone'
import { whatsappVerifyNumber } from '../lib/supabase'

/** The message the person sends; the code is what the server checks. */
export const verifyMessage = (code: string) => `Hisaab code: ${code}\n(Sending this verifies my number.)`

/**
 * Proves `phone` is yours, for free: you send a code from that number's
 * WhatsApp to Hisaab's WhatsApp number, and the server sees which number it
 * came from. Calls `onVerified` once the message has arrived.
 */
export function VerifyPhone({ phone, onVerified }: { phone: string; onVerified: () => void }) {
  const { t } = useT()
  const start = useMutation({ mutationFn: () => api.startPhoneVerification(phone) })
  const code = start.data
  const status = useQuery({
    queryKey: ['phone-verified', phone, code],
    queryFn: () => api.phoneVerificationStatus(phone),
    enabled: Boolean(code),
    // Check every few seconds, and right away when they come back from WhatsApp.
    refetchInterval: (q) => (q.state.data ? false : 3000),
    refetchOnWindowFocus: 'always',
  })
  const verified = status.data === true
  const reported = useRef(false)
  useEffect(() => {
    if (verified && !reported.current) {
      reported.current = true
      onVerified()
    }
  }, [verified, onVerified])

  const link = code ? `https://wa.me/${whatsappVerifyNumber}?text=${encodeURIComponent(verifyMessage(code))}` : null
  return (
    <div className="space-y-3 rounded-2xl bg-[#25D366]/10 p-4 text-sm ring-1 ring-[#25D366]/30">
      <p className="font-semibold">{t('Verify {phone} on WhatsApp', { phone: formatPhone(phone) })}</p>
      <ol className="list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-200">
        <li>{t('Open WhatsApp on the phone with this number.')}</li>
        <li>{t('Send the message we fill in for you. That’s it — no OTP, no charges.')}</li>
      </ol>
      {verified ? (
        <p className="font-semibold text-owed dark:text-owed-dark">✅ {t('Verified')}</p>
      ) : link ? (
        <>
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#25D366] font-semibold text-white"
          >
            <IconWhatsApp size={20} /> {t('Send code on WhatsApp')}
          </a>
          <p className="text-center text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
            {t('Waiting for your message… ({code})', { code: code ?? '' })}
          </p>
        </>
      ) : (
        <button
          type="button"
          disabled={start.isPending}
          onClick={() => start.mutate()}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] font-semibold text-white disabled:opacity-60"
        >
          <IconWhatsApp size={20} /> {start.isPending ? t('Getting a code…') : t('Verify on WhatsApp')}
        </button>
      )}
      {start.error || status.error ? <p className="text-red-600">{friendlyError(start.error ?? status.error)}</p> : null}
    </div>
  )
}
