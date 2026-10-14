import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { incomingCodes, validSignature } from '../../supabase/functions/_shared/whatsapp'

const delivery = (messages: unknown[]) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages } }] }] })

describe('incomingCodes', () => {
  it('finds codes in text messages, with the sender', () => {
    const payload = delivery([
      { from: '919876543210', id: 'wamid.1', type: 'text', text: { body: 'Hisaab code: hsb-ab3k9m2q — sending this verifies my number' } },
      { from: '919876543211', id: 'wamid.2', type: 'text', text: { body: 'hello' } },
      { from: '919876543212', id: 'wamid.3', type: 'image' },
    ])
    expect(incomingCodes(payload)).toEqual([{ from: '919876543210', code: 'HSB-AB3K9M2Q', messageId: 'wamid.1' }])
  })

  it('ignores status updates and junk', () => {
    expect(incomingCodes({ entry: [{ changes: [{ value: { statuses: [{ id: 'x' }] } }] }] })).toEqual([])
    expect(incomingCodes(null)).toEqual([])
    expect(incomingCodes(delivery([{ type: 'text', text: { body: 'HSB-AB3K9M2Q' } }]))).toEqual([]) // no sender
  })
})

describe('validSignature', () => {
  const body = JSON.stringify(delivery([]))
  const sign = (secret: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')

  it('accepts Meta’s HMAC of the raw body', async () => {
    expect(await validSignature('app-secret', body, sign('app-secret'))).toBe(true)
  })

  it('rejects a wrong secret, a changed body or a missing header', async () => {
    expect(await validSignature('app-secret', body, sign('other'))).toBe(false)
    expect(await validSignature('app-secret', body + ' ', sign('app-secret'))).toBe(false)
    expect(await validSignature('app-secret', body, null)).toBe(false)
    expect(await validSignature('app-secret', body, 'sha1=abc')).toBe(false)
  })
})
