// Sends Web Push messages with the VAPID keys from the function's secrets.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { PushMessage } from './messages.ts'

export const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hisaab@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

export interface Subscription {
  endpoint: string
  p256dh: string
  auth: string
}

/** Sends one message; forgets subscriptions the browser has thrown away. */
export async function send(sub: Subscription, message: PushMessage): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(message),
      { TTL: 60 * 60 * 24 },
    )
    return true
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    if (status === 404 || status === 410) await admin.rpc('drop_push_subscription', { p_endpoint: sub.endpoint })
    else console.error('push failed', status, error)
    return false
  }
}

/** Requests must carry the shared secret configured on the webhook / workflow. */
export function authorised(req: Request): boolean {
  const secret = Deno.env.get('HISAAB_SECRET')
  return Boolean(secret) && req.headers.get('x-hisaab-secret') === secret
}
