/**
 * Normalises a phone number to E.164 (+919876543210).
 * Numbers without a country code are assumed to be Indian.
 * Returns null when the input cannot be a valid number.
 */
export function normalizePhone(input: string, defaultCountryCode = '91'): string | null {
  const trimmed = input.trim()
  const hasPlus = trimmed.startsWith('+')
  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  if (hasPlus) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2)
  } else if (defaultCountryCode === '91' && digits.length === 12 && digits.startsWith('91')) {
    // 91XXXXXXXXXX typed without the plus
  } else {
    digits = digits.replace(/^0+/, '')
    digits = defaultCountryCode + digits
  }

  if (digits.startsWith('91') && !/^91[6-9]\d{9}$/.test(digits)) return null
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null
  return '+' + digits
}

/** +919876543210 -> +91 98765 43210 */
export function formatPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164)
  return m ? `+91 ${m[1]} ${m[2]}` : e164
}
