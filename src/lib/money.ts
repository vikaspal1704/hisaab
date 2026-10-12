/** All amounts are integer paise. ₹1 = 100 paise. */
export type Paise = number

export const MAX_AMOUNT: Paise = 1_000_000_000 // ₹1 crore, matches the database limit

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const inrExact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** ₹1,23,450 or ₹99.50 — drops ".00" for whole rupees. */
export function formatINR(paise: Paise, opts: { signed?: boolean } = {}): string {
  const abs = Math.abs(paise)
  const text = abs % 100 === 0 ? inr.format(abs / 100) : inrExact.format(abs / 100)
  if (opts.signed && paise !== 0) return (paise < 0 ? '−' : '+') + text
  return paise < 0 ? '−' + text : text
}

/**
 * Parses what a person typed ("1,250", "99.5", "₹ 40") into paise.
 * Returns null for anything that is not a positive amount with at most 2 decimals.
 */
export function parseRupees(input: string): Paise | null {
  const cleaned = input.replace(/[₹,\s]/g, '')
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned) && !/^\.\d{1,2}$/.test(cleaned)) return null
  const [whole, fraction = ''] = cleaned.split('.')
  const paise = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(paise) || paise <= 0 || paise > MAX_AMOUNT) return null
  return paise
}

/** Paise to an editable string: 12350 -> "123.50", 12300 -> "123". */
export function toRupeeInput(paise: Paise): string {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2)
}
