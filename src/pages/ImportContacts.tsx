import { useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconContacts } from '../components/icons'
import { Page } from '../components/Page'
import { CheckRow, SearchBox } from '../components/PeoplePicker'
import { useToast } from '../components/Toast'
import { Button, Card, LoadingView, SectionTitle } from '../components/ui'
import { useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { parseContactsFile, toCandidates, type ImportCandidate, type RawContact } from '../lib/contactsImport'
import { friendlyError } from '../lib/errors'
import { useT } from '../lib/i18n'
import { formatPhone } from '../lib/phone'

interface ContactsManager {
  select(props: string[], options: { multiple: boolean }): Promise<{ name?: string[]; tel?: string[] }[]>
}
const contactsApi = (navigator as Navigator & { contacts?: ContactsManager }).contacts

/**
 * Bring friends in from the phone instead of typing them: the phone's contact
 * picker (Android Chrome) or a .vcf/.csv export (any phone). Importing the
 * file again later adds only the new people, which works as a manual sync.
 */
export function ImportContactsPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const toast = useToast()
  const people = usePeople()
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(!contactsApi)
  const save = useLedgerMutation((rows: ImportCandidate[]) => api.addContacts(rows.map(({ phone, name }) => ({ phone, name }))))

  const existingPhones = useMemo(() => new Set(people.list.filter((p) => p.is_contact).map((p) => p.phone)), [people.list])

  const load = (raw: RawContact[]) => {
    const rows = toCandidates(raw, { myPhone: people.me?.phone ?? '', existingPhones }).filter((c) => c.status !== 'me')
    if (rows.length === 0) {
      setError(t('No mobile numbers found in those contacts.'))
      return
    }
    setError(null)
    setCandidates(rows)
    // From the picker you've already chosen who you want; from a whole address book, start empty.
    setSelected(new Set())
  }

  const fromPicker = async () => {
    if (!contactsApi) return
    try {
      const picked = await contactsApi.select(['name', 'tel'], { multiple: true })
      const raw = picked.map((c) => ({ name: c.name?.[0] ?? '', phones: c.tel ?? [] }))
      const rows = toCandidates(raw, { myPhone: people.me?.phone ?? '', existingPhones }).filter((c) => c.status !== 'me')
      setCandidates(rows)
      setSelected(new Set(rows.filter((r) => r.status === 'new').map((r) => r.phone)))
      setError(rows.length ? null : t('No mobile numbers found in those contacts.'))
    } catch {
      // Picker closed.
    }
  }

  const fromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 10_000_000) return setError(t('That file is too big (over 10 MB).'))
    try {
      load(parseContactsFile(file.name, await file.text()))
    } catch {
      setError(t('Couldn’t read that file. Use a .vcf or .csv contacts export.'))
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
        navigate('/', { replace: true })
      },
    })
  }

  if (people.isPending) return <Page title={t('Import contacts')} back><LoadingView /></Page>

  return (
    <Page
      title={t('Import contacts')}
      back
      footer={
        candidates ? (
          <div className="pb-1">
            {save.error ? <p className="mb-2 text-center text-sm text-red-600">{friendlyError(save.error)}</p> : null}
            <Button block busy={save.isPending} disabled={selected.size === 0} onClick={submit}>
              {selected.size === 0 ? t('Select friends to add') : t('Add {n} friends', { n: selected.size })}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="mt-2 space-y-3">
        {contactsApi ? (
          <Button block onClick={fromPicker}>
            <IconContacts /> {t('Choose from phone contacts')}
          </Button>
        ) : null}
        <label className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white font-semibold ring-1 ring-slate-200 active:bg-slate-100 dark:bg-slate-900 dark:ring-slate-700">
          📇 {t('Import a contacts file (.vcf or .csv)')}
          <input
            type="file"
            accept=".vcf,.vcard,.csv,text/vcard,text/x-vcard,text/csv"
            onChange={fromFile}
            className="sr-only"
            aria-label={t('Contacts file')}
          />
        </label>
        {error ? <p className="text-center text-sm text-red-600">{error}</p> : null}
      </div>

      <button type="button" onClick={() => setShowHelp(!showHelp)} className="mt-4 min-h-10 text-sm font-semibold text-brand-700 dark:text-brand-500">
        {showHelp ? '▾' : '▸'} {t('How do I get a contacts file?')}
      </button>
      {showHelp ? (
        <Card className="space-y-2 p-4 text-sm text-slate-600 dark:text-slate-300">
          <p><strong>iPhone:</strong> {t('Contacts app → Lists → touch and hold “All Contacts” → Export → save the .vcf to Files, then pick it here.')}</p>
          <p><strong>Android:</strong> {t('Contacts app → Fix & manage (or Settings) → Export to file → save the .vcf, then pick it here.')}</p>
          <p><strong>Google Contacts:</strong> {t('contacts.google.com → Export → vCard or Google CSV.')}</p>
          <p className="text-xs text-slate-500">
            {t('The file is read on your phone. Only the people you tick are saved to Hisaab. Import again any time to add new contacts — friends you already have are skipped.')}
          </p>
        </Card>
      ) : null}

      {candidates ? (
        <>
          <SectionTitle
            action={
              newVisible.length > 0 ? (
                <button type="button" onClick={toggleAll} className="min-h-9 text-sm font-semibold text-brand-700 dark:text-brand-500">
                  {allVisibleSelected ? t('Clear') : t('Select all ({n})', { n: newVisible.length })}
                </button>
              ) : undefined
            }
          >
            {t('{n} contacts with a mobile number', { n: candidates.length })}
          </SectionTitle>
          <SearchBox value={query} onChange={setQuery} />
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
          {visible.length > 300 ? (
            <p className="mt-2 text-center text-sm text-slate-500">{t('Showing 300 — search to find others.')}</p>
          ) : null}
        </>
      ) : null}
    </Page>
  )
}
