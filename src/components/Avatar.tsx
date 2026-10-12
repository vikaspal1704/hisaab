const PALETTE = [
  'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  'bg-lime-100 text-lime-800 dark:bg-lime-900/50 dark:text-lime-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200',
  'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/50 dark:text-fuchsia-200',
]

function hash(text: string) {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function Avatar({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${PALETTE[hash(id) % PALETTE.length]}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

/** Overlapping avatars side by side for a pair or group. */
export function AvatarStack({ people, size = 40 }: { people: { id: string; name: string }[]; size?: number }) {
  const shown = people.slice(0, 3)
  const small = Math.round(size * 0.78)
  const step = Math.round(small * 0.55)
  return (
    <span className="relative inline-flex shrink-0 items-center" style={{ width: small + step * (shown.length - 1), height: size }} aria-hidden>
      {shown.map((p, i) => (
        <span key={p.id} className="absolute rounded-full ring-2 ring-white dark:ring-slate-900" style={{ left: i * step, zIndex: shown.length - i }}>
          <Avatar id={p.id} name={p.name} size={small} />
        </span>
      ))}
    </span>
  )
}
