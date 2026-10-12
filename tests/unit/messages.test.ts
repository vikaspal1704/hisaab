import { describe, expect, it } from 'vitest'
import { digestMessage, eventMessage } from '../../supabase/functions/_shared/messages'

const base = { actor_name: 'Rahul', action: 'created' as const, kind: 'expense' as const, description: 'Dinner', amount: 90000, my_delta: -30000, entry_id: 'e1' }

describe('push messages', () => {
  it('tells me what an entry means for me', () => {
    expect(eventMessage(base)).toEqual({
      title: 'Rahul added “Dinner”',
      body: '₹900 · your share ₹300. Looks right? Tap to confirm.',
      url: '#/e/e1',
    })
    expect(eventMessage({ ...base, action: 'deleted' }).body).toBe('It no longer counts in your balance.')
    expect(eventMessage({ ...base, kind: 'payment', my_delta: -50000 }).body).toBe('₹500 received. Tap to check.')
    expect(eventMessage({ ...base, kind: 'forgive', my_delta: 3700 }).title).toBe('🙏 Rahul let it go')
    expect(eventMessage({ ...base, kind: 'treat', my_delta: 0 }).body).toContain('nobody owes')
  })

  it('summarises the week, and stays quiet with no balances', () => {
    expect(digestMessage({ owed_to_me: 50000, i_owe: 120000, people_count: 3 })?.body).toBe(
      'Right now you’ll get back ₹500 and you owe ₹1,200. Your baari next time you go out!',
    )
    expect(digestMessage({ owed_to_me: 0, i_owe: 0, people_count: 0 })).toBeNull()
  })
})
