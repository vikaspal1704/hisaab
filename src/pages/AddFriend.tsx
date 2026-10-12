import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconContacts, IconWhatsApp } from '../components/icons'
import { Page } from '../components/Page'
import { Button, ButtonLink, Card, Field, TextInput } from '../components/ui'
import { useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError, InputError } from '../lib/errors'
import { normalizePhone } from '../lib/phone'
import { useT } from '../lib/i18n'
import { inviteText, whatsappLink } from '../lib/share'

interface PickedContact {
  name?: string[]
  tel?: string[]
}

interface ContactsManager {
  select(props: string[], options: { multiple: boolean }): Promise<PickedContact[]>
}

const contactsApi = (navigator as Navigator & { contacts?: ContactsManager }).contacts

export function AddFriendPage() {
  const navigate = useNavigate()
  const { t } = useT()
  const people = usePeople()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<{ id: string; name: string; phone: string }[]>([])
  const add = useLedgerMutation((args: { phone: string; name: string }) => api.addContact(args.phone, args.name))

  const addOne = async (rawName: string, rawPhone: string) => {
    const e164 = normalizePhone(rawPhone)
    if (!rawName.trim()) throw new InputError(t('Enter a name'))
    if (!e164) throw new InputError(t('“{phone}” doesn’t look like a mobile number', { phone: rawPhone }))
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

  const pickFromContacts = async () => {
    if (!contactsApi) return
    setError(null)
    try {
      const picked = await contactsApi.select(['name', 'tel'], { multiple: true })
      const problems: string[] = []
      for (const c of picked) {
        const tel = c.tel?.find((t) => normalizePhone(t)) ?? c.tel?.[0]
        try {
          await addOne(c.name?.[0] ?? '', tel ?? '')
        } catch (e) {
          problems.push(`${c.name?.[0] ?? t('Contact')}: ${friendlyError(e)}`)
        }
      }
      if (problems.length) setError(problems.join('\n'))
    } catch {
      // The person closed the picker.
    }
  }

  const registered = (id: string) => people.byId.get(id)?.is_registered

  return (
    <Page title={t('Add friends')} back>
      {contactsApi ? (
        <Button variant="secondary" block className="mt-2" onClick={pickFromContacts}>
          <IconContacts /> {t('Choose from phone contacts')}
        </Button>
      ) : null}

      <div className="mt-5 space-y-4">
        <Field label={t('Name')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={t('What you call them')} maxLength={60} autoComplete="off" />
        </Field>
        <Field label={t('Mobile number')} hint={t('This is how Hisaab links you up when they join.')}>
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
                <span className="block text-xs text-slate-500">{registered(a.id) ? t('Already on Hisaab') : t('Not on Hisaab yet')}</span>
              </span>
              {!registered(a.id) ? (
                <a href={whatsappLink(a.phone, inviteText(a.name))} target="_blank" rel="noreferrer" className="flex min-h-9 items-center gap-1 rounded-full bg-[#25D366]/15 px-3 text-sm font-semibold text-[#128C7E] dark:text-[#25D366]">
                  <IconWhatsApp size={16} /> {t('Invite')}
                </a>
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
    </Page>
  )
}
