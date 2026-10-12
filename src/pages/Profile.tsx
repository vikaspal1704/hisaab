import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Avatar, AvatarStack } from '../components/Avatar'
import { Page } from '../components/Page'
import { PayMeSheet } from '../components/PayMeSheet'
import { IconQr } from '../components/icons'
import { useToast } from '../components/Toast'
import { Button, ButtonLink, Card, Field, LoadingView, Row, SectionTitle, Segmented, TextInput } from '../components/ui'
import { useHouseholds, useLedgerMutation, usePeople, useShortcuts } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError, InputError } from '../lib/errors'
import { formatPhone } from '../lib/phone'
import { useT } from '../lib/i18n'
import { currentSubscription, disablePush, enablePush, pushAvailable } from '../lib/push'
import { isLikelyUpiId } from '../lib/upi'

export function ProfilePage() {
  const { signOut } = useAuth()
  const { t } = useT()
  const people = usePeople()
  const households = useHouseholds()
  const me = people.me
  const [showQr, setShowQr] = useState(false)

  if (!me) return <Page title={t('Me')} withNav><LoadingView /></Page>

  return (
    <Page title={t('Me')} withNav wide>
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
      <div>
      <div className="flex items-center gap-4 pt-2 lg:rounded-3xl lg:bg-white lg:p-6 lg:shadow-card lg:ring-1 lg:ring-slate-200/70 dark:lg:bg-slate-900 dark:lg:ring-slate-800">
        <Avatar id={me.id} name={me.display_name} size={64} />
        <div>
          <p className="text-xl font-semibold">{me.display_name}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{formatPhone(me.phone)}</p>
        </div>
      </div>
      <Button variant="secondary" block className="mt-4" onClick={() => setShowQr(true)}>
        <IconQr size={18} /> {t('My UPI QR — let friends scan to pay')}
      </Button>
      {showQr ? <PayMeSheet open onClose={() => setShowQr(false)} /> : null}

      <ProfileForm key={`${me.display_name}|${me.upi_id}`} name={me.display_name} phone={me.phone} upi={me.upi_id ?? ''} />
      </div>
      <div className="lg:-mt-7">

      <SectionTitle action={<ButtonLink to="/pairs/new" variant="ghost" className="min-h-9 text-sm">{t('+ New pair')}</ButtonLink>}>
        {t('Couples & pairs')}
      </SectionTitle>
      {households.data && households.data.length > 0 ? (
        <Card className="divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
          {households.data.map((h) => (
            <Row
              key={h.id}
              to={`/h/${h.id}`}
              leading={<AvatarStack people={h.memberIds.map((m) => ({ id: m, name: people.name(m) }))} />}
              title={h.name}
              subtitle={h.memberIds.map((m) => people.name(m)).join(' · ')}
            />
          ))}
        </Card>
      ) : (
        <Card className="p-4 text-sm text-slate-600 dark:text-slate-300">
          {t('Group a couple or roommates so you see one combined balance and either of them can settle for both.')}
        </Card>
      )}

      <ShortcutList />

      <Preferences />

      <SectionTitle>{t('Install the app')}</SectionTitle>
      <Card className="space-y-2 p-4 text-sm text-slate-600 dark:text-slate-300">
        <p><strong>Android (Chrome):</strong> {t('menu ⋮ → “Add to Home screen” / “Install app”.')}</p>
        <p><strong>iPhone (Safari):</strong> {t('Share → “Add to Home Screen”.')}</p>
      </Card>

      <Button variant="secondary" block className="mt-6" onClick={signOut}>{t('Sign out')}</Button>
      </div>
      </div>
    </Page>
  )
}

function ProfileForm({ name: initialName, phone, upi: initialUpi }: { name: string; phone: string; upi: string }) {
  const toast = useToast()
  const { t } = useT()
  const [name, setName] = useState(initialName)
  const [upi, setUpi] = useState(initialUpi)
  const save = useLedgerMutation(async () => {
    if (!name.trim()) throw new InputError(t('Name can’t be empty'))
    if (upi.trim() && !isLikelyUpiId(upi)) throw new InputError(t('Looks like name@bank (e.g. ravi@okaxis)'))
    await api.claimProfile(name.trim(), phone, upi.trim() || null)
  })
  const dirty = name !== initialName || upi !== initialUpi

  return (
    <>
      <SectionTitle>{t('Profile')}</SectionTitle>
      <Card className="space-y-4 p-4">
        <Field label={t('Name')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field label="UPI ID" hint={t('Friends see this on “Settle up” so they can pay you in one tap.')}>
          <TextInput value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="yourname@okaxis" autoCapitalize="none" autoCorrect="off" />
        </Field>
        {save.error ? <p className="text-sm text-red-600">{friendlyError(save.error)}</p> : null}
        <Button block disabled={!dirty} busy={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => toast(t('Profile saved')) })}>
          {t('Save')}
        </Button>
      </Card>
    </>
  )
}

function Preferences() {
  const { t, lang, setLang } = useT()
  const toast = useToast()
  const [pushOn, setPushOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    currentSubscription().then((s) => setPushOn(Boolean(s))).catch(() => setPushOn(false))
  }, [])

  const togglePush = async () => {
    setBusy(true)
    try {
      if (pushOn) {
        await disablePush()
        setPushOn(false)
      } else {
        const ok = await enablePush()
        setPushOn(ok)
        if (!ok) toast(t('Notifications are blocked. Allow them in your browser settings.'))
      }
    } catch (error) {
      toast(friendlyError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SectionTitle>{t('Language')}</SectionTitle>
      <Segmented
        label={t('Language')}
        value={lang}
        onChange={setLang}
        options={[
          { value: 'en', label: 'English' },
          { value: 'hi', label: 'Hinglish' },
        ]}
      />
      <SectionTitle>{t('Notifications')}</SectionTitle>
      <Card className="p-4 text-sm">
        {pushAvailable() ? (
          <>
            <p className="text-slate-600 dark:text-slate-300">
              {t('Get a ping when a friend adds or changes something with you, plus a short weekly summary.')}
            </p>
            <Button variant={pushOn ? 'secondary' : 'primary'} block className="mt-3" busy={busy || pushOn === null} onClick={togglePush}>
              {pushOn ? t('Turn off notifications') : t('Turn on notifications')}
            </Button>
          </>
        ) : (
          <p className="text-slate-600 dark:text-slate-300">
            {t('Notifications aren’t available here. On iPhone, add Hisaab to your home screen first. Changes still show up live, with a badge on Activity.')}
          </p>
        )}
      </Card>
    </>
  )
}

/** Home-screen shortcuts, with a way to remove the ones you don't use. */
function ShortcutList() {
  const { t } = useT()
  const shortcuts = useShortcuts()
  const remove = useLedgerMutation((id: string) => api.deleteShortcut(id))
  if (!shortcuts.data || shortcuts.data.length === 0) return null
  return (
    <>
      <SectionTitle>{t('Shortcuts')}</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {shortcuts.data.map((s) => (
          <div key={s.id} className="flex min-h-12 items-center gap-3 px-4 text-sm">
            <span className="flex-1">⚡ {s.label}</span>
            <button type="button" className="min-h-9 text-red-600" onClick={() => remove.mutate(s.id)}>
              {t('Remove')}
            </button>
          </div>
        ))}
      </Card>
    </>
  )
}
