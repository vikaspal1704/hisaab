import { formatINR, type Paise } from './money'

export interface NudgePrefs {
  remind_above: Paise
  remind_after_days: number
  last_nudged_at: string | null
}

const DAY = 86_400_000

/**
 * Whether it's a good moment to (gently) remind someone: they owe at least
 * my comfort amount, nothing has happened between us for a while, and I
 * haven't reminded them recently.
 */
export function shouldNudge(net: Paise, lastActivity: string | null, prefs: NudgePrefs, now = new Date()): boolean {
  if (net < prefs.remind_above || net <= 0) return false
  const quietFor = lastActivity ? now.getTime() - new Date(lastActivity).getTime() : Infinity
  if (quietFor < prefs.remind_after_days * DAY) return false
  if (prefs.last_nudged_at && now.getTime() - new Date(prefs.last_nudged_at).getTime() < prefs.remind_after_days * DAY) return false
  return true
}

export type Tone = 'baari' | 'friendly' | 'direct'

/**
 * Reminder text that keeps it light. Framed as "your turn" rather than
 * "you owe me", so nobody has to feel petty.
 */
export function nudgeMessage(args: {
  name: string
  amount: Paise
  tone: Tone
  myUpi?: string | null
  link?: string | null
}): string {
  const first = args.name.split(' ')[0]
  const amount = formatINR(args.amount)
  const body = {
    baari: `${first} bhai, next baari teri 😄 Hisaab mein ${amount} tere naam hai — agli chai/dinner tu de dena, barabar ho jayega!`,
    friendly: `Hey ${first}! Hisaab says ${amount} is on your side. No rush — pick up the next one or send it whenever 🙂`,
    direct: `Hi ${first}, a quick reminder: ${amount} is pending as per our Hisaab. Could you send it when you get a moment?`,
  }[args.tone]
  const pay = args.myUpi ? `\nUPI: ${args.myUpi}` : ''
  const link = args.link ? `\nDekh lo: ${args.link}` : ''
  return body + pay + link
}
