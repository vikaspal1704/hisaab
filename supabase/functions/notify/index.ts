// Called by a Database Webhook on INSERT into public.entry_events.
// Pushes "Rahul added “Dinner” · your share ₹300" to everyone else on the entry.
import { eventMessage, type EventTarget } from '../_shared/messages.ts'
import { admin, authorised, send } from '../_shared/push.ts'

Deno.serve(async (req) => {
  if (!authorised(req)) return new Response('forbidden', { status: 403 })
  const payload = await req.json()
  const eventId = payload?.record?.id
  if (payload?.type !== 'INSERT' || typeof eventId !== 'number') return new Response('ignored')

  const { data, error } = await admin.rpc('push_targets', { p_event: eventId })
  if (error) return new Response(error.message, { status: 500 })

  const results = await Promise.all(
    (data as (EventTarget & { endpoint: string; p256dh: string; auth: string })[]).map((row) =>
      send(row, eventMessage({ ...row, amount: Number(row.amount), my_delta: Number(row.my_delta) })),
    ),
  )
  return Response.json({ sent: results.filter(Boolean).length })
})
