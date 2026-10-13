import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { InviteSheet } from '../components/FriendSheets'
import { IconContacts, IconWhatsApp } from '../components/icons'
import { Page } from '../components/Page'
import { Button, ButtonLink, Card, Field, TextInput } from '../components/ui'
import { useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError, InputError } from '../lib/errors'
import { normalizePhone } from '../lib/phone'
import { useT } from '../lib/i18n'

export function AddFriendPage() {
  const navigate = useNavigate()
  const { t } = useT()
  const people = usePeople()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<{ id: string; name: string; phone: string | null }[]>([])
  const [inviting, setInviting] = useState<string | null>(null)
  const add = useLedgerMutation((args: { phone: string | null; name: string }) =>
    args.phone ? api.addContact(args.phone, args.name) : api.addContactByName(args.name),
  )

  const addOne = async (rawName: string, rawPhone: string) => {
    // No number is fine: they can be given one later from their page.
    const e164 = rawPhone.trim() ? normalizePhone(rawPhone) : null
    if (!rawName.trim()) throw new InputError(t('Enter a name'))
    if (rawPhone.trim() && !e164) throw new InputError(t('“{phone}” doesn’t look like a mobile number', { phone: rawPhone }))
    const id = await add.mutateAsync({ phone: e164, name: rawName.trim() })
    setAdded((list) => [...list.filter((a) => a.id !== id), { id, name: rawName.trim(), phone: e164 }])
  }

  const submit = async () => {
    setError(null)
    try {
      await addOne(name, phone)
      setName('')
      setPhone('')
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  const registered = (id: string) => people.byId.get(id)?.is_registered

  return (
    <Page title={t('Add friends')} back>
      <ButtonLink to="/friends/import" block className="mt-2">
        <IconContacts /> {t('Import from your contacts')}
      </ButtonLink>
      <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">{t('Or add one friend by hand:')}</p>

      <div className="mt-5 space-y-4">
        <Field label={t('Name')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={t('What you call them')} maxLength={60} autoComplete="off" />
        </Field>
        <Field
          label={t('Mobile number (optional)')}
          hint={t('This is how Hisaab links you up when they join. Don’t have it? Add just the name — you can add the number later.')}
        >
          <TextInput type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" autoComplete="off" />
        </Field>
        {error ? <p className="text-sm whitespace-pre-line text-red-600">{error}</p> : null}
        <Button block busy={add.isPending} onClick={submit}>{t('Add friend')}</Button>
      </div>

      {added.length > 0 ? (
        <Card className="mt-6 divide-y divide-slate-100 dark:divide-slate-800">
          {added.map((a) => (
            <div key={a.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <span className="flex-1">
                <span className="block font-medium">✓ {a.name}</span>
                <span className="block text-xs text-slate-500">
                  {a.phone === null ? t('No number yet') : registered(a.id) ? t('Already on Hisaab') : t('Not on Hisaab yet')}
                </span>
              </span>
              {!registered(a.id) ? (
                <button type="button" onClick={() => setInviting(a.id)} className="flex min-h-9 items-center gap-1 rounded-full bg-[#25D366]/15 px-3 text-sm font-semibold text-[#128C7E] dark:text-[#25D366]">
                  <IconWhatsApp size={16} /> {t('Invite')}
                </button>
              ) : null}
            </div>
          ))}
        </Card>
      ) : null}
      {added.length > 0 ? (
        <div className="mt-4 flex gap-3">
          <ButtonLink to={`/add?with=${added.map((a) => a.id).join(',')}`} variant="secondary" className="flex-1">{t('Add expense')}</ButtonLink>
          <Button className="flex-1" onClick={() => navigate('/')}>{t('Done')}</Button>
        </div>
      ) : (
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {t('Friends don’t need the app to start. Add them now — when they sign up with this number, they’ll see everything.')}
        </p>
      )}
      {inviting ? <InviteSheet open onClose={() => setInviting(null)} personId={inviting} /> : null}
    </Page>
  )
}
