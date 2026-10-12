import { parseRupees, type Paise } from './money'

/**
 * Reads a one-line entry like "450 chai", "chai 450", "₹1,200 dinner at Toit"
 * or "dinner ₹1200.50". The first amount-looking token is the amount; the
 * rest is the description.
 */
export function parseQuickAdd(input: string): { amount: Paise | null; description: string } {
  const text = input.trim()
  const match = /(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d{1,2})?)/i.exec(text)
  if (!match) return { amount: null, description: text }
  const amount = parseRupees(match[1])
  const description = (text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(for|on)\s+/i, '')
  return { amount, description }
}
