import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { IconCheck, IconClipboard, IconContacts, IconKeyboard, IconUpload } from '../components/icons'
import { Page } from '../components/Page'
import { CheckRow, SearchBox } from '../components/PeoplePicker'
import { useToast } from '../components/Toast'
import { Button, Card, inputClass, LoadingView, Segmented } from '../components/ui'
import { useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { parseContactsFile, parsePastedContacts, toCandidates, type ImportCandidate, type RawContact } from '../lib/contactsImport'
import { friendlyError } from '../lib/errors'
import { useT } from '../lib/i18n'
import { formatPhone } from '../lib/phone'
import { contactPicker, detectPlatform, type Platform } from '../lib/platform'

type Source = 'picker' | 'file' | 'paste'
type Method = 'file' | 'paste'

/** Contacts read on the Friends page and handed over for review. */
export interface ImportHandoff {
  raw: RawContact[]
  source: Source
}

/** Reads the phone's contact picker; null when it's unavailable or closed. */
export async function pickFromPhone(): Promise<RawContact[] | null> {
  if (!contactPicker) return null
  try {
    const picked = await contactPicker.select(['name', 'tel'], { multiple: true })
    return picked.map((c) => ({ name: c.name?.[0] ?? '', phones: c.tel ?? [] }))
  } catch {
    return null
  }
}

/** Reads a .vcf/.csv file; throws a message for the person if it can't. */
export async function readContactsFile(file: File, t: (s: string) => string): Promise<RawContact[]> {
  if (file.size > 10_000_000) throw new Error(t('That file is too big (over 10 MB).'))
  try {
    return parseContactsFile(file.name, await file.text())
  } catch {
    throw new Error(t('Couldn’t read that file. Use a .vcf or .csv contacts export.'))
  }
}

/**
 * Bring friends in without typing: pick from the phone (Android Chrome), a
 * contacts file from any phone, or a pasted list. Then tick who to add.
 * Importing again later only offers new people, so it works as a manual sync.
 */
export function ImportContactsPage() {
  // Every visit starts fresh (a new import, or contacts handed over from the Friends page).
  const location = useLocation()
  return <ImportFlow key={location.key} />
}

function ImportFlow() {
  const { t } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const people = usePeople()
  const handoff = (location.state as ImportHandoff | null) ?? null
  const [method, setMethod] = useState<Method | null>(new URLSearchParams(location.search).get('via') === 'paste' ? 'paste' : null)
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadedHandoff, setLoadedHandoff] = useState(false)
  const save = useLedgerMutation((rows: ImportCandidate[]) => api.addContacts(rows.map(({ phone, name }) => ({ phone, name }))))

  const existingPhones = useMemo(() => new Set(people.list.filter((p) => p.is_contact).map((p) => p.phone)), [people.list])

  const load = (raw: RawContact[], source: Source) => {
    const rows = toCandidates(raw, { myPhone: people.me?.phone ?? '', existingPhones }).filter((c) => c.status !== 'me')
    if (rows.length === 0) {
      setError(t('No mobile numbers found in those contacts.'))
      return
    }
    setError(null)
    setCandidates(rows)
    // Picked or pasted: you already chose these people. A whole address book: start empty.
    setSelected(source === 'file' ? new Set() : new Set(rows.filter((r) => r.status === 'new').map((r) => r.phone)))
  }

  // Contacts read on the Friends page arrive here for review.
  if (handoff && !loadedHandoff && !people.isPending) {
    setLoadedHandoff(true)
    load(handoff.raw, handoff.source)
  }

  const fromPicker = async () => {
    const raw = await pickFromPhone()
    if (raw) load(raw, 'picker')
  }

  const fromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      load(await readContactsFile(file, t), 'file')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (candidates ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\s/g, '')))
  }, [candidates, query])
  const newVisible = visible.filter((c) => c.status === 'new')
  const allVisibleSelected = newVisible.length > 0 && newVisible.every((c) => selected.has(c.phone))

  const toggle = (phone: string) => {
    const next = new Set(selected)
    if (next.has(phone)) next.delete(phone)
    else next.add(phone)
    setSelected(next)
  }
  const toggleAll = () => {
    const next = new Set(selected)
    for (const c of newVisible) {
      if (allVisibleSelected) next.delete(c.phone)
      else next.add(c.phone)
    }
    setSelected(next)
  }

  const submit = () => {
    const rows = (candidates ?? []).filter((c) => selected.has(c.phone))
    save.mutate(rows, {
      onSuccess: (added) => {
        toast(t('Added {n} friends', { n: added }))
        navigate('/friends', { replace: true })
      },
    })
  }

  if (people.isPending) return <Page title={t('Import contacts')} back><LoadingView /></Page>

  // Step 2: review and tick.
  if (candidates) {
    const newCount = candidates.filter((c) => c.status === 'new').length
    return (
      <Page
        title={t('Choose who to add')}
        back
        footer={
          <div className="pb-1">
            {save.error ? <p className="mb-2 text-center text-sm text-red-600">{friendlyError(save.error)}</p> : null}
            <Button block busy={save.isPending} disabled={selected.size === 0} onClick={submit}>
              {selected.size === 0 ? t('Select friends to add') : t('Add {n} friends', { n: selected.size })}
            </Button>
          </div>
        }
      >
        <Steps step={2} />
        <Card className="mt-4 flex items-center gap-3 p-3 text-sm">
          <span className="flex-1 text-slate-600 dark:text-slate-300">
            {t('{n} contacts with a mobile number · {m} new', { n: candidates.length, m: newCount })}
          </span>
          {newVisible.length > 0 ? (
            <Button variant={allVisibleSelected ? 'secondary' : 'primary'} className="min-h-10 shrink-0 text-sm" onClick={toggleAll}>
              {allVisibleSelected ? t('Clear') : t('Select all ({n})', { n: newVisible.length })}
            </Button>
          ) : null}
        </Card>
        <div className="mt-3">
          <SearchBox value={query} onChange={setQuery} />
        </div>
        <Card className="mt-3 divide-y divide-slate-100 px-3 dark:divide-slate-800">
          {visible.slice(0, 300).map((c) =>
            c.status === 'existing' ? (
              <div key={c.phone} className="flex min-h-14 items-center gap-3 py-2 opacity-60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block text-sm text-slate-500">{t('Already your friend')}</span>
                </span>
              </div>
            ) : (
              <CheckRow key={c.phone} checked={selected.has(c.phone)} onClick={() => toggle(c.phone)} id={c.phone} name={c.name} subtitle={formatPhone(c.phone)} />
            ),
          )}
        </Card>
        {visible.length > 300 ? <p className="mt-2 text-center text-sm text-slate-500">{t('Showing 300 — search to find others.')}</p> : null}
        <Button variant="ghost" block className="mt-3" onClick={() => setCandidates(null)}>{t('Start over')}</Button>
      </Page>
    )
  }

  // Step 1: choose how.
  return (
    <Page title={t('Import contacts')} back>
      <Steps step={1} />
      <p className="mt-4 text-slate-600 dark:text-slate-300">{t('Pick the easiest way for you. Nothing is added until you choose who.')}</p>
      <div className="mt-4 space-y-3">
        {contactPicker ? (
          <Option
            icon={<IconContacts />}
            title={t('Pick from your phone')}
            body={t('Opens your phone’s contacts. Tick friends, done.')}
            badge={t('Easiest')}
            onClick={fromPicker}
          />
        ) : null}
        <Option
          icon={<IconUpload />}
          title={t('Upload a contacts file')}
          body={t('Export all contacts from your phone (we show you how), then pick the file.')}
          open={method === 'file'}
          onClick={() => setMethod(method === 'file' ? null : 'file')}
        >
          <FileHelp onFile={fromFile} />
        </Option>
        <Option
          icon={<IconClipboard />}
          title={t('Paste names and numbers')}
          body={t('A list from anywhere — e.g. copy members from a WhatsApp group.')}
          open={method === 'paste'}
          onClick={() => setMethod(method === 'paste' ? null : 'paste')}
        >
          <PasteBox onRead={(raw) => load(raw, 'paste')} />
        </Option>
        <Link
          to="/friends/new"
          className="flex min-h-16 items-center gap-4 rounded-2xl bg-white p-4 text-left shadow-card ring-1 ring-slate-200/70 transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:ring-slate-800 dark:hover:bg-slate-800/60"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><IconKeyboard /></span>
          <span>
            <span className="block font-semibold">{t('Type a number')}</span>
            <span className="block text-sm text-slate-500 dark:text-slate-400">{t('For one or two friends.')}</span>
          </span>
        </Link>
      </div>
      {error ? <p className="mt-4 text-center text-sm text-red-600">{error}</p> : null}
      <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
        {t('Your contacts are read on your phone. Only the people you tick are saved. Import again any time — friends you already have are skipped.')}
      </p>
    </Page>
  )
}

function Steps({ step }: { step: 1 | 2 }) {
  const { t } = useT()
  const item = (n: 1 | 2, label: string) => (
    <span className={`flex items-center gap-2 text-sm font-medium ${step >= n ? 'text-brand-700 dark:text-brand-400' : 'text-slate-400'}`}>
      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${step > n ? 'bg-brand-700 text-white' : step === n ? 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200' : 'bg-slate-200 text-slate-500 dark:bg-slate-800'}`}>
        {step > n ? <IconCheck size={14} /> : n}
      </span>
      {label}
    </span>
  )
  return (
    <div className="mt-2 flex items-center gap-3" aria-label={t('Step {n} of 2', { n: step })}>
      {item(1, t('Choose how'))}
      <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      {item(2, t('Pick friends'))}
    </div>
  )
}

function Option({
  icon,
  title,
  body,
  badge,
  open,
  onClick,
  children,
}: {
  icon: ReactNode
  title: string
  body: string
  badge?: string
  open?: boolean
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <div className={`overflow-hidden rounded-2xl bg-white shadow-card ring-1 dark:bg-slate-900 ${open ? 'ring-2 ring-brand-600' : 'ring-slate-200/70 dark:ring-slate-800'}`}>
      <button
        type="button"
        onClick={onClick}
        aria-expanded={children ? Boolean(open) : undefined}
        className="flex min-h-16 w-full items-center gap-4 p-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-semibold">
            {title}
            {badge ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-200">{badge}</span> : null}
          </span>
          <span className="block text-sm text-slate-500 dark:text-slate-400">{body}</span>
        </span>
      </button>
      {open && children ? <div className="border-t border-slate-100 p-4 dark:border-slate-800">{children}</div> : null}
    </div>
  )
}

const EXPORT_STEPS: Record<Exclude<Platform, 'other'> | 'google', string[]> = {
  iphone: [
    'Open the Contacts app and tap “Lists” (top left).',
    'Touch and hold “All Contacts”, then tap “Export”.',
    'Choose “Save to Files”, then come back and pick that file below.',
  ],
  android: [
    'Open the Contacts app → “Fix & manage” (or menu → Settings).',
    'Tap “Export to file” and save the .vcf.',
    'Come back and pick that file below.',
  ],
  google: [
    'On a computer, open contacts.google.com.',
    'Click “Export” → choose “vCard” or “Google CSV”.',
    'Pick the downloaded file below.',
  ],
}

function FileHelp({ onFile }: { onFile: (e: ChangeEvent<HTMLInputElement>) => void }) {
  const { t } = useT()
  const detected = detectPlatform()
  const [platform, setPlatform] = useState<'iphone' | 'android' | 'google'>(detected === 'other' ? 'google' : detected)
  return (
    <div className="space-y-4">
      <Segmented
        label={t('Your phone')}
        value={platform}
        onChange={setPlatform}
        options={[
          { value: 'iphone', label: 'iPhone' },
          { value: 'android', label: 'Android' },
          { value: 'google', label: 'Google Contacts' },
        ]}
      />
      <ol className="space-y-2.5">
        {EXPORT_STEPS[platform].map((step, i) => (
          <li key={step} className="flex gap-3 text-sm text-slate-700 dark:text-slate-300">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{i + 1}</span>
            <span className="pt-0.5">{t(step)}</span>
          </li>
        ))}
      </ol>
      <label className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 font-semibold text-white transition-colors hover:bg-brand-800 dark:bg-brand-600">
        <IconUpload size={18} /> {t('Choose contacts file')}
        <input
          type="file"
          accept=".vcf,.vcard,.csv,text/vcard,text/x-vcard,text/csv"
          onChange={onFile}
          className="sr-only"
          aria-label={t('Contacts file')}
        />
      </label>
    </div>
  )
}

function PasteBox({ onRead }: { onRead: (raw: RawContact[]) => void }) {
  const { t } = useT()
  const [text, setText] = useState('')
  const found = useMemo(() => parsePastedContacts(text).length, [text])
  return (
    <div className="space-y-3">
      <textarea
        aria-label={t('Names and numbers')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={'Rahul - 98765 43210\nPriya 99887 76655\n+91 91234 56789'}
        className={`${inputClass} py-2.5 font-mono text-sm`}
      />
      <Button block disabled={found === 0} onClick={() => onRead(parsePastedContacts(text))}>
        {found ? t('Use {n} numbers', { n: found }) : t('Paste a list first')}
      </Button>
    </div>
  )
}
