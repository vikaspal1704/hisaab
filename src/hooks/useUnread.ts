import { useSyncExternalStore } from 'react'
import { useActivity, usePeople } from './queries'

const KEY = 'hisaab.lastSeenEvent'
const listeners = new Set<() => void>()

function readSeen(): number {
  try {
    return Number(localStorage.getItem(KEY) ?? 0)
  } catch {
    return 0
  }
}

export function markActivitySeen(eventId: number) {
  if (eventId <= readSeen()) return
  try {
    localStorage.setItem(KEY, String(eventId))
  } catch {
    // Without storage the badge just can't remember.
  }
  listeners.forEach((l) => l())
}

/** How many activity events by other people arrived since I last opened Activity. */
export function useUnreadCount(): number {
  const seen = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    readSeen,
  )
  const activity = useActivity()
  const me = usePeople().me?.id
  if (!activity.data || seen === 0) return 0
  return activity.data.filter((a) => a.event_id > seen && a.actor_id !== me).length
}
