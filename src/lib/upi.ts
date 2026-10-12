import type { Paise } from './money'

/**
 * A upi://pay link. On Android it opens the UPI app chooser with payee and
 * amount filled in. Some apps refuse links for person-to-person payments, so
 * callers should always offer "copy UPI ID" as well, and never assume the
 * payment happened until the user confirms.
 */
export function upiPayLink(args: { upiId: string; name: string; amount: Paise; note?: string }): string {
  const params = new URLSearchParams({
    pa: args.upiId,
    pn: args.name.slice(0, 50),
    am: (args.amount / 100).toFixed(2),
    cu: 'INR',
  })
  if (args.note) params.set('tn', args.note.slice(0, 80))
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`
}

export function isLikelyUpiId(value: string): boolean {
  return /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,63}$/.test(value.trim())
}
