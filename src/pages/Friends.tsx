import { useMemo, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { InviteSheet } from '../components/FriendSheets'
import { IconClipboard, IconContacts, IconUpload, IconUserPlus, IconWhatsApp } from '../components/icons'
import { StyledBalance } from '../components/Money'
import { HeaderButton, Page } from '../components/Page'
import { SearchBox } from '../components/PeoplePicker'
import { Card, EmptyState, ErrorView, LoadingView, Segmented } from '../components/ui'
import { useBalances, useContactPrefs, usePeople } from '../hooks/queries'
import { friendlyError } from '../lib/errors'
import { useT } from '../lib/i18n'
import { formatPhone } from '../lib/phone'
import { contactPicker } from '../lib/platform'
import { pickFromPhone, readContactsFile, type ImportHandoff } from './ImportContacts'

type Filter = 'all' | 'joined' | 'waiting'

/** Everyone you keep hisaab with, and the quickest ways to bring more people in. */
export function FriendsPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const people = usePeople()
  const balances = useBalances()
  const prefs = useContactPrefs()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [inviting, setInviting] = useState<string | null>(null)

  const friends = useMemo(
    () => people.list.filter((p) => p.is_contact && !p.is_me).sort((a, b) => a.display_name.localeCompare(b.display_name)),
    [people.list],
  )
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return friends
      .filter((p) => filter === 'all' || (filter === 'joined' ? p.is_registered : !p.is_registered))
      .filter((p) => !q || p.display_name.toLowerCase().includes(q) || p.phone.includes(q.replace(/\s/g, '')))
  }, [friends, filter, query])
  const waiting = friends.filter((p) => !p.is_registered).length

  return (
    <Page
      title={t('Friends')}
      withNav
      wide
      actions={
        <HeaderButton label={t('Add friend')} onClick={() => navigate('/friends/new')}>
          <IconUserPlus />
        </HeaderButton>
      }
    >
      {people.isPending ? (
        <LoadingView />
      ) : people.error ? (
        <ErrorView message={friendlyError(people.error)} onRetry={() => people.refetch()} />
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
          <div className="lg:order-2 lg:sticky lg:top-8">
            <ImportCard prominent={friends.length < 5} />
          </div>
          <div className="lg:order-1">
            {friends.length === 0 ? (
              <EmptyState
                icon={<IconContacts size={40} />}
                title={t('No friends yet')}
                body={t('Import your contacts above, or add someone by their number. They don’t need the app to start.')}
              />
            ) : (
              <>
                <div className="mt-5 space-y-3 lg:mt-0">
                  <SearchBox value={query} onChange={setQuery} />
                  <Segmented
                    label={t('Show')}
                    value={filter}
                    onChange={setFilter}
                    options={[
                      { value: 'all', label: t('All ({n})', { n: friends.length }) },
                      { value: 'joined', label: t('On Hisaab ({n})', { n: friends.length - waiting }) },
                      { value: 'waiting', label: t('Not yet ({n})', { n: waiting }) },
                    ]}
                  />
                </div>
                {visible.length === 0 ? (
                  <p className="px-1 py-8 text-center text-sm text-slate-500">{t('Nobody matches that.')}</p>
                ) : (
                  <Card className="mt-3 divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
                    {visible.map((p) => {
                      const pref = prefs.prefs(p.id)
                      return (
                        <div key={p.id} className="flex items-center gap-2 pr-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <Link to={`/p/${p.id}`} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4">
                            <Avatar id={p.id} name={p.display_name} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{p.display_name}</span>
                              <span className="block truncate text-sm text-slate-500 dark:text-slate-400">
                                {p.is_registered ? formatPhone(p.phone) : t('Not on Hisaab yet')}
                              </span>
                            </span>
                            {balances.byId.has(p.id) ? (
                              <StyledBalance net={balances.net(p.id)} style={pref.style} tolerance={pref.tolerance} />
                            ) : null}
                          </Link>
                          {!p.is_registered ? (
                            <button
                              type="button"
                              onClick={() => setInviting(p.id)}
                              className="flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-[#25D366]/15 px-3 text-sm font-semibold text-[#0b7a63] transition-colors hover:bg-[#25D366]/25 dark:text-[#25D366]"
                            >
                              <IconWhatsApp size={16} /> {t('Invite')}
                            </button>
                          ) : null}
                        </div>
                      )
                    })}
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {inviting ? <InviteSheet open onClose={() => setInviting(null)} personId={inviting} /> : null}
    </Page>
  )
}

/** One tap to the easiest way of importing; contacts read here go straight to "pick who". */
function ImportCard({ prominent }: { prominent: boolean }) {
  const { t } = useT()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const review = (handoff: ImportHandoff) => navigate('/friends/import', { state: handoff })

  const fromPicker = async () => {
    const raw = await pickFromPhone()
    if (raw) review({ raw, source: 'picker' })
  }
  const fromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      review({ raw: await readContactsFile(file, t), source: 'file' })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const tile =
    'flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl bg-white/10 px-2 py-3 text-center text-sm font-semibold text-white ring-1 ring-white/15 transition-colors hover:bg-white/20'
  return (
    <section
      aria-label={t('Import contacts')}
      className={`mt-2 rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 p-5 text-white shadow-raised lg:mt-0 ${prominent ? '' : 'lg:p-5'}`}
    >
      <p className="text-lg font-semibold">{prominent ? t('Bring your friends in') : t('Import more contacts')}</p>
      <p className="mt-1 text-sm text-brand-100">{t('Pick who to add — nothing is saved until you choose.')}</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {contactPicker ? (
          <button type="button" onClick={fromPicker} className={tile}>
            <IconContacts size={22} /> {t('From phone')}
          </button>
        ) : (
          <Link to="/friends/import" className={tile}>
            <IconContacts size={22} /> {t('From phone')}
          </Link>
        )}
        <label className={`${tile} cursor-pointer`}>
          <IconUpload size={22} /> {t('From a file')}
          <input type="file" accept=".vcf,.vcard,.csv,text/vcard,text/x-vcard,text/csv" onChange={fromFile} className="sr-only" aria-label={t('Contacts file')} />
        </label>
        <Link to="/friends/import?via=paste" className={tile}>
          <IconClipboard size={22} /> {t('Paste a list')}
        </Link>
      </div>
      <Link to="/friends/import" className="mt-3 block text-center text-sm font-medium text-brand-100 underline-offset-2 hover:underline">
        {t('Not sure how? See step-by-step help')}
      </Link>
      {error ? <p className="mt-2 text-center text-sm text-amber-200">{error}</p> : null}
    </section>
  )
}
