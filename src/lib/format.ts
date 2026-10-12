/** Today's date in the user's timezone as YYYY-MM-DD (not UTC, which can be "yesterday" in India before 5:30am). */
export function todayISO(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseISODate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** "12 Oct" this year, "12 Oct 2025" otherwise. */
export function formatDay(iso: string, now = new Date()): string {
  const date = parseISODate(iso)
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/** "October 2026" — used to group a passbook by month. */
export function formatMonth(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 Oct". */
export function formatRelative(timestamp: string, now = new Date()): string {
  const then = new Date(timestamp)
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400 && then.getDate() === now.getDate()) return `${Math.floor(seconds / 3600)} h ago`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (then.toDateString() === yesterday.toDateString()) return 'yesterday'
  return formatDay(todayISO(then), now)
}
