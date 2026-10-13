import { formatINR, type Paise } from './money'

/**
 * The public address of the web app (without the hash route), for links sent
 * to friends. The Android app runs from a local address, so it uses the
 * deployed site (VITE_PUBLIC_URL) instead.
 */
export function appUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_URL as string | undefined
  return configured || window.location.origin + window.location.pathname
}

/** Opens WhatsApp with a prefilled message to a number, or to a chat you pick when there's no number. */
export function whatsappLink(phoneE164: string | null, text: string): string {
  return `https://wa.me/${phoneE164 ? phoneE164.replace(/\D/g, '') : ''}?text=${encodeURIComponent(text)}`
}

/** The passbook link a friend can open without an account (it's also their invite). */
export function sharedUrl(token: string): string {
  return `${appUrl()}#/s/${token}`
}

export function inviteText(friendName: string, link: string, toThisNumber = true): string {
  const join = toThisNumber ? 'sign in with this number' : 'sign in with your number'
  return `Hey ${friendName}! I’m keeping our shared expenses on Hisaab so we don’t have to split every bill. Here’s our hisaab so far — no app needed: ${link}\n\nTap “Join” there and ${join} to add your own.`
}

export function reminderText(friendName: string, amount: Paise, myUpi: string | null): string {
  const pay = myUpi ? ` You can pay me on UPI: ${myUpi}.` : ''
  return `Hey ${friendName}, as per Hisaab you owe me ${formatINR(amount)}. No rush — or just pick up the next bill!${pay} ${appUrl()}`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
