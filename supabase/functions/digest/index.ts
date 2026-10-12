// Weekly summary push, triggered by the "Weekly digest" GitHub workflow.
import { digestMessage } from '../_shared/messages.ts'
import { admin, authorised, send } from '../_shared/push.ts'

Deno.serve(async (req) => {
  if (!authorised(req)) return new Response('forbidden', { status: 403 })
  const { data, error } = await admin.rpc('digest_targets')
  if (error) return new Response(error.message, { status: 500 })

  let sent = 0
  for (const row of data as { endpoint: string; p256dh: string; auth: string; owed_to_me: number; i_owe: number; people_count: number }[]) {
    const message = digestMessage({ owed_to_me: Number(row.owed_to_me), i_owe: Number(row.i_owe), people_count: row.people_count })
    if (message && (await send(row, message))) sent++
  }
  return Response.json({ sent })
})
