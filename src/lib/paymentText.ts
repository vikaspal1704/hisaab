import { parseRupees, type Paise } from './money'

export interface ParsedPayment {
  amount: Paise | null
  payeeName: string | null
  upiId: string | null
}

const AMOUNT = /(?:₹|\brs\.?|\binr)\s*([\d,]+(?:\.\d{1,2})?)/i
const UPI_ID = /\b([A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,63})\b/
// "to Rahul Verma", "paid to RAHUL VERMA on", "to VPA rahul@okaxis"
const PAYEE = /\b(?:paid\s+)?to\s+(?:vpa\s+)?([A-Za-z][A-Za-z .'-]{1,60}?)(?=\s+(?:on|via|using|ref|upi|from|for|was|is|successfully|\d)\b|\s*[\n,;(.|]|$)/i

function titleCase(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

/**
 * Reads the text that GPay, PhonePe, Paytm or a bank SMS shares after a UPI
 * payment and pulls out the amount and who it went to. Anything it can't
 * find is null; the person confirms everything on the add-expense screen.
 */
export function parsePaymentText(text: string): ParsedPayment {
  const amountMatch = AMOUNT.exec(text)
  const amount = amountMatch ? parseRupees(amountMatch[1]) : null
  const upiId = UPI_ID.exec(text)?.[1]?.toLowerCase() ?? null
  const payeeMatch = PAYEE.exec(text)
  let payeeName = payeeMatch ? titleCase(payeeMatch[1]) : null
  if (payeeName && /^(vpa|a\/c|account|your|you|the)$/i.test(payeeName)) payeeName = null
  return { amount, payeeName, upiId }
}

/** Finds the contact a parsed payment most likely went to. */
export function matchPayee<T extends { id: string; display_name: string; upi_id: string | null }>(
  parsed: ParsedPayment,
  people: T[],
): T | null {
  if (parsed.upiId) {
    const byUpi = people.find((p) => p.upi_id?.toLowerCase() === parsed.upiId)
    if (byUpi) return byUpi
  }
  if (!parsed.payeeName) return null
  const wanted = parsed.payeeName.toLowerCase().split(' ')
  let best: { person: T; score: number } | null = null
  for (const person of people) {
    const have = person.display_name.toLowerCase().split(/\s+/)
    const score = wanted.filter((w) => have.includes(w)).length
    if (score > 0 && (!best || score > best.score)) best = { person, score }
  }
  return best?.person ?? null
}
