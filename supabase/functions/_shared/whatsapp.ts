// WhatsApp Cloud API helpers for number verification. Pure, so they're unit-tested.

/** The verification code format handed out by start_phone_verification(). */
export const CODE_PATTERN = /HSB-[2-9A-HJ-NP-Z]{8}/i

export interface IncomingCode {
  /** sender's WhatsApp number, digits only (e.g. 919876543210) */
  from: string
  code: string
  /** WhatsApp message id, for replying */
  messageId: string
}

interface WebhookPayload {
  entry?: { changes?: { value?: { messages?: { from?: string; id?: string; type?: string; text?: { body?: string } }[] } }[] }[]
}

/** Every text message in a webhook delivery that carries a verification code. */
export function incomingCodes(payload: unknown): IncomingCode[] {
  const out: IncomingCode[] = []
  for (const entry of (payload as WebhookPayload)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        const match = message.type === 'text' ? CODE_PATTERN.exec(message.text?.body ?? '') : null
        if (match && message.from) out.push({ from: message.from, code: match[0].toUpperCase(), messageId: message.id ?? '' })
      }
    }
  }
  return out
}

/**
 * Checks Meta's X-Hub-Signature-256 header ("sha256=<hex HMAC of the raw body
 * with the app secret>") in constant time.
 */
export async function validSignature(appSecret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)))
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
  const given = header.slice('sha256='.length).toLowerCase()
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}
