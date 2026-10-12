import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { QrCode, qrPngDataUrl } from './QrCode'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { IconCopy } from './icons'
import { usePeople } from '../hooks/queries'
import { useT } from '../lib/i18n'
import { formatINR, type Paise } from '../lib/money'
import { copyText } from '../lib/share'
import { upiPayLink } from '../lib/upi'

/**
 * My UPI QR, for a friend to scan with any UPI app. UPI no longer lets people
 * send each other "collect" requests, so this (or a pay link) is how you ask.
 * With an amount it's filled in for them; without, they type it.
 */
export function PayMeSheet({
  open,
  onClose,
  amount,
  payerName,
  recordTo,
}: {
  open: boolean
  onClose: () => void
  amount?: Paise
  payerName?: string
  /** where "they've paid — record it" goes */
  recordTo?: string
}) {
  const { t } = useT()
  const toast = useToast()
  const me = usePeople().me
  const upi = me?.upi_id ?? null
  const link = useMemo(
    () => (upi && me ? upiPayLink({ upiId: upi, name: me.display_name, amount, note: 'Hisaab' }) : null),
    [upi, me, amount],
  )
  const png = useMemo(() => (link ? qrPngDataUrl(link) : null), [link])

  return (
    <Sheet open={open} onClose={onClose} title={amount ? t('Get paid {amount}', { amount: formatINR(amount) }) : t('My UPI QR')}>
      {!link || !upi || !png ? (
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <p>{t('Add your UPI ID first — your QR is made from it.')}</p>
          <Link to="/me" onClick={onClose} className="flex min-h-11 items-center justify-center rounded-xl bg-brand-700 font-semibold text-white">
            {t('Add UPI ID')}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <div className="rounded-3xl bg-white p-3 ring-1 ring-slate-200">
            <QrCode text={link} label={t('UPI QR code for {upi}', { upi })} />
          </div>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            {payerName
              ? t('{name} scans this with GPay, PhonePe, Paytm or any UPI app', { name: payerName })
              : t('Scan with GPay, PhonePe, Paytm or any UPI app')}
          </p>
          <button
            type="button"
            onClick={async () => toast((await copyText(upi)) ? t('UPI ID copied') : upi)}
            className="mt-2 flex min-h-10 items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            <IconCopy size={16} /> {upi}
          </button>
          <div className="mt-4 grid w-full grid-cols-2 gap-2">
            <a
              href={png}
              download={`hisaab-upi-${upi.split('@')[0]}.png`}
              className="flex min-h-11 items-center justify-center rounded-xl text-sm font-semibold ring-1 ring-slate-300 dark:ring-slate-700"
            >
              {t('Save image')}
            </a>
            {recordTo ? (
              <Link to={recordTo} onClick={onClose} className="flex min-h-11 items-center justify-center rounded-xl bg-brand-700 text-sm font-semibold text-white">
                {t('They paid — record it')}
              </Link>
            ) : (
              <button type="button" onClick={onClose} className="min-h-11 rounded-xl bg-brand-700 text-sm font-semibold text-white">
                {t('Done')}
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">{t('Hisaab never sees the payment. Record it once the money arrives.')}</p>
        </div>
      )}
    </Sheet>
  )
}
