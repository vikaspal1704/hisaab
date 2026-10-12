import { formatINR, type Paise } from './money'

/** The address of this app (without the hash route), for invite messages. */
export function appUrl(): string {
  return window.location.origin + window.location.pathname
}

/** Opens WhatsApp with a prefilled message to a number. */
export function whatsappLink(phoneE164: string, text: string): string {
  return `https://wa.me/${phoneE164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

/** The passbook link a friend can open without an account (it's also their invite). */
export function sharedUrl(token: string): string {
  return `${appUrl()}#/s/${token}`
}

export function inviteText(friendName: string, link: string): string {
  return `Hey ${friendName}! I’m keeping our shared expenses on Hisaab so we don’t have to split every bill. Here’s our hisaab so far — no app needed: ${link}\n\nTap “Join” there and sign in with this number to add your own.`
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
