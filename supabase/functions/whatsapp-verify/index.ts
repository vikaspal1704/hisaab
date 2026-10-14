// Receives WhatsApp messages sent to Hisaab's WhatsApp number (Meta Cloud API
// webhook). A message carrying a code from the app proves the sender owns that
// number: confirm_whatsapp_verification() checks the code was issued for it.
//
// Secrets: WHATSAPP_VERIFY_TOKEN (any string, also typed into Meta's webhook
// setup), WHATSAPP_APP_SECRET (Meta app secret, to check signatures).
// Optional, to reply "verified ✅": WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { incomingCodes, validSignature } from '../_shared/whatsapp.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

async function reply(to: string, messageId: string, text: string) {
  const token = Deno.env.get('WHATSAPP_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  if (!token || !phoneNumberId) return
  // A reply within 24 hours of the user's message is a free "service" message.
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, context: { message_id: messageId }, type: 'text', text: { body: text } }),
  })
  if (!res.ok) console.error('reply failed', res.status, await res.text())
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  // Meta's one-time webhook check.
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === Deno.env.get('WHATSAPP_VERIFY_TOKEN')
    return ok ? new Response(url.searchParams.get('hub.challenge') ?? '') : new Response('forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const raw = await req.text()
  if (!(await validSignature(Deno.env.get('WHATSAPP_APP_SECRET') ?? '', raw, req.headers.get('x-hub-signature-256')))) {
    return new Response('bad signature', { status: 401 })
  }
  for (const { from, code, messageId } of incomingCodes(JSON.parse(raw))) {
    const { data, error } = await admin.rpc('confirm_whatsapp_verification', { p_code: code, p_from: from })
    if (error) {
      console.error('confirm failed', error.message)
      continue
    }
    await reply(
      from,
      messageId,
      data
        ? '✅ Your number is verified. Go back to Hisaab — it continues by itself.'
        : '❌ That code didn’t work. Codes last 15 minutes and must be sent from the number you entered. Get a new one in the app.',
    )
  }
  // Always 200, or Meta keeps retrying.
  return new Response('ok')
})
