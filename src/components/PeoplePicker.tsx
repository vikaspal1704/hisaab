import { useMemo, useState } from 'react'
import { usePeople, useLedgerMutation } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { normalizePhone } from '../lib/phone'
import { useT } from '../lib/i18n'
import { Avatar } from './Avatar'
import { IconCheck, IconSearch } from './icons'
import { Button, inputClass, TextInput } from './ui'

/** Name + phone mini form for adding a friend without leaving the current screen. */
export function InlineAddFriend({ onAdded, initialName = '' }: { onAdded: (id: string) => void; initialName?: string }) {
  const { t } = useT()
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mutation = useLedgerMutation((args: { phone: string | null; name: string }) =>
    args.phone ? api.addContact(args.phone, args.name) : api.addContactByName(args.name),
  )

  const add = () => {
    // No number is fine: they can be given one later.
    const e164 = phone.trim() ? normalizePhone(phone) : null
    if (!name.trim()) return setError(t('Enter a name'))
    if (phone.trim() && !e164) return setError(t('Enter a valid mobile number'))
    setError(null)
    mutation.mutate(
      { phone: e164, name: name.trim() },
      {
        onSuccess: (id) => {
          setName('')
          setPhone('')
          onAdded(id)
        },
        onError: (e) => setError(friendlyError(e)),
      },
    )
  }

  return (
    <div className="space-y-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/50">
      <p className="text-sm font-medium">{t('New friend')}</p>
      <TextInput placeholder={t('Name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      <TextInput type="tel" inputMode="tel" placeholder={t('Mobile number (optional)')} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <p className="text-xs text-slate-500 dark:text-slate-400">{t('Don’t have it? Add just the name — you can add the number later.')}</p>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <Button block variant="secondary" busy={mutation.isPending} onClick={add}>{t('Add friend')}</Button>
    </div>
  )
}

/** Searchable multi-select over my contacts. */
export function ContactChecklist({
  selected,
  onToggle,
  allowAdd = true,
}: {
  selected: Set<string>
  onToggle: (id: string) => void
  allowAdd?: boolean
}) {
  const people = usePeople()
  const { t } = useT()
  const [query, setQuery] = useState('')
  const contacts = useMemo(() => {
    const q = query.trim().toLowerCase()
    return people.list
      .filter((p) => p.is_contact && !p.is_me)
      .filter((p) => !q || p.display_name.toLowerCase().includes(q) || (p.phone ?? '').includes(q))
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
  }, [people.list, query])

  return (
    <div className="space-y-3">
      <SearchBox value={query} onChange={setQuery} />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {contacts.map((p) => (
          <li key={p.id}>
            <CheckRow checked={selected.has(p.id)} onClick={() => onToggle(p.id)} id={p.id} name={p.display_name} />
          </li>
        ))}
        {contacts.length === 0 ? <li className="py-4 text-center text-sm text-slate-500">{t('No matching friends')}</li> : null}
      </ul>
      {allowAdd ? <InlineAddFriend onAdded={(id) => onToggle(id)} initialName={contacts.length === 0 ? query : ''} /> : null}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const { t } = useT()
  return (
    <div className="relative">
      <IconSearch size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t('Search name or number')}
        autoFocus={autoFocus}
        aria-label={t('Search')}
        className={`${inputClass} pl-10`}
      />
    </div>
  )
}

export function CheckRow({
  checked,
  onClick,
  id,
  name,
  subtitle,
  leading,
}: {
  checked: boolean
  onClick: () => void
  id: string
  name: string
  subtitle?: string
  leading?: React.ReactNode
}) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={onClick} className="flex min-h-14 w-full items-center gap-3 py-2 text-left">
      {leading ?? <Avatar id={id} name={name} size={36} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{name}</span>
        {subtitle ? <span className="block truncate text-sm text-slate-500 dark:text-slate-400">{subtitle}</span> : null}
      </span>
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full ring-2 ${
          checked ? 'bg-brand-700 text-white ring-brand-700' : 'ring-slate-300 dark:ring-slate-600'
        }`}
      >
        {checked ? <IconCheck size={16} /> : null}
      </span>
    </button>
  )
}
