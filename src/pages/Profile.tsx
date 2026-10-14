import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Avatar, AvatarStack } from '../components/Avatar'
import { Page } from '../components/Page'
import { PayMeSheet } from '../components/PayMeSheet'
import { Sheet } from '../components/Sheet'
import { VerifyPhone } from '../components/VerifyPhone'
import { IconQr } from '../components/icons'
import { useToast } from '../components/Toast'
import { Button, ButtonLink, Card, Field, LoadingView, Row, SectionTitle, Segmented, TextInput } from '../components/ui'
import { useHouseholds, useLedgerMutation, usePeople, useShortcuts } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError, InputError } from '../lib/errors'
import { clearInvite, pendingInvite } from '../lib/invite'
import { formatPhone, normalizePhone } from '../lib/phone'
import { whatsappVerifyNumber } from '../lib/supabase'
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
  const [phoneSheet, setPhoneSheet] = useState<'change' | 'verify' | null>(null)

  if (!me) return <Page title={t('Me')} withNav><LoadingView /></Page>

  return (
    <Page title={t('Me')} withNav wide>
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
      <div>
      <div className="flex items-center gap-4 pt-2 lg:rounded-3xl lg:bg-white lg:p-6 lg:shadow-card lg:ring-1 lg:ring-slate-200/70 dark:lg:bg-slate-900 dark:lg:ring-slate-800">
        <Avatar id={me.id} name={me.display_name} size={64} />
        <div>
          <p className="text-xl font-semibold">{me.display_name}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {me.phone ? formatPhone(me.phone) : null}
            {me.phone_verified ? <span className="ml-1.5 font-medium text-owed dark:text-owed-dark">✓ {t('Verified')}</span> : null}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm font-semibold">
            <button type="button" onClick={() => setPhoneSheet('change')} className="min-h-8 text-brand-700 dark:text-brand-400">
              {t('Change number')}
            </button>
            {!me.phone_verified && whatsappVerifyNumber && me.phone ? (
              <button type="button" onClick={() => setPhoneSheet('verify')} className="min-h-8 text-brand-700 dark:text-brand-400">
                {t('Verify')}
              </button>
            ) : null}
          </p>
        </div>
      </div>
      {phoneSheet ? (
        <ChangeNumberSheet current={me.phone ?? ''} verifyOnly={phoneSheet === 'verify'} onClose={() => setPhoneSheet(null)} />
      ) : null}
      <Button variant="secondary" block className="mt-4" onClick={() => setShowQr(true)}>
        <IconQr size={18} /> {t('My UPI QR — let friends scan to pay')}
      </Button>
      {showQr ? <PayMeSheet open onClose={() => setShowQr(false)} /> : null}

      <ProfileForm key={`${me.display_name}|${me.upi_id}`} name={me.display_name} phone={me.phone ?? ''} upi={me.upi_id ?? ''} />
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

/**
 * Change my number (or just verify the current one). With WhatsApp
 * verification set up, the new number is verified first; otherwise it's
 * saved as typed, under the same rules as signing up.
 */
function ChangeNumberSheet({ current, verifyOnly, onClose }: { current: string; verifyOnly: boolean; onClose: () => void }) {
  const { t } = useT()
  const toast = useToast()
  const [text, setText] = useState('')
  const [target, setTarget] = useState<string | null>(verifyOnly ? current : null)
  const save = useLedgerMutation((phone: string) => api.changeMyPhone(phone, pendingInvite()))
  const { mutate } = save
  const apply = useCallback(
    (phone: string) =>
      mutate(phone, {
        onSuccess: () => {
          clearInvite()
          toast(verifyOnly ? t('Number verified') : t('Number changed'))
          onClose()
        },
      }),
    [mutate, toast, t, verifyOnly, onClose],
  )
  const next = () => {
    const e164 = normalizePhone(text)
    if (!e164) return toast(t('Enter a valid mobile number'))
    if (e164 === current) return toast(t('That’s already your number.'))
    if (whatsappVerifyNumber) setTarget(e164)
    else apply(e164)
  }
  const onVerified = useCallback(() => {
    if (target) apply(target)
  }, [target, apply])

  return (
    <Sheet open onClose={onClose} title={verifyOnly ? t('Verify your number') : t('Change your number')}>
      <div className="space-y-4">
        {!verifyOnly ? (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('Your hisaab stays with you. Friends see your new number; the old one is free for its real owner.')}
            </p>
            <Field label={t('New mobile number')}>
              <TextInput
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                placeholder="98765 43210"
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setTarget(null)
                }}
              />
            </Field>
          </>
        ) : null}
        {target ? (
          <VerifyPhone key={target} phone={target} onVerified={onVerified} />
        ) : (
          <Button block busy={save.isPending} onClick={next}>
            {whatsappVerifyNumber ? t('Next') : t('Change number')}
          </Button>
        )}
        {save.isPending && target ? <p className="text-center text-sm text-slate-500">{t('Saving…')}</p> : null}
        {save.error ? <p className="text-sm text-red-600">{friendlyError(save.error)}</p> : null}
      </div>
    </Sheet>
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
