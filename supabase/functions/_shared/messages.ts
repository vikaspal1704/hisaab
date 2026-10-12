// Notification wording. Plain TypeScript with no Deno or Node APIs, so the
// app's unit tests can cover it too.

export interface EventTarget {
  actor_name: string
  action: 'created' | 'edited' | 'deleted' | 'restored'
  kind: 'expense' | 'payment' | 'forgive' | 'treat'
  description: string
  amount: number
  /** paise from the recipient's side: positive = they are owed more */
  my_delta: number
  entry_id: string
}

export interface PushMessage {
  title: string
  body: string
  url: string
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 })
export const rupees = (paise: number) => inr.format(Math.abs(paise) / 100)

export function eventMessage(e: EventTarget): PushMessage {
  const verb = { created: 'added', edited: 'changed', deleted: 'deleted', restored: 'restored' }[e.action]
  const url = `#/e/${e.entry_id}`
  if (e.action === 'deleted') {
    return { title: `${e.actor_name} deleted “${e.description}”`, body: 'It no longer counts in your balance.', url }
  }
  if (e.kind === 'treat') {
    return { title: `🎁 ${e.actor_name} logged a treat`, body: `${e.description} · ${rupees(e.amount)} — nobody owes anything.`, url }
  }
  if (e.kind === 'forgive') {
    return { title: `🙏 ${e.actor_name} let it go`, body: `${rupees(e.my_delta)} cleared — chhod diya!`, url }
  }
  if (e.kind === 'payment') {
    const body = e.my_delta < 0 ? `${rupees(e.my_delta)} received` : `${rupees(e.my_delta)} recorded as paid by you`
    return { title: `🤝 ${e.actor_name} ${verb} a payment`, body: `${body}. Tap to check.`, url }
  }
  const effect = e.my_delta > 0 ? `you get back ${rupees(e.my_delta)}` : e.my_delta < 0 ? `your share ${rupees(e.my_delta)}` : 'no change for you'
  return { title: `${e.actor_name} ${verb} “${e.description}”`, body: `${rupees(e.amount)} · ${effect}. Looks right? Tap to confirm.`, url }
}

export function digestMessage(d: { owed_to_me: number; i_owe: number; people_count: number }): PushMessage | null {
  if (d.people_count === 0) return null
  const parts: string[] = []
  if (d.owed_to_me > 0) parts.push(`you’ll get back ${rupees(d.owed_to_me)}`)
  if (d.i_owe > 0) parts.push(`you owe ${rupees(d.i_owe)}`)
  const body = parts.length ? `Right now ${parts.join(' and ')}.` : 'You’re all square 🎉'
  const tip = d.i_owe > d.owed_to_me ? ' Your baari next time you go out!' : ''
  return { title: 'Your weekly hisaab', body: body + tip, url: '#/' }
}
