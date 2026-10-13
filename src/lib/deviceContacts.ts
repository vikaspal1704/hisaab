import { Contacts, PhoneType } from '@capacitor-community/contacts'
import type { RawContact } from './contactsImport'
import { isNativeApp } from './native'

/** Inside the Android app, Hisaab can read the whole phone address book (with permission). */
export const deviceContactsAvailable = isNativeApp()

const MOBILE = new Set<string>([PhoneType.Mobile, PhoneType.WorkMobile])

/**
 * Reads every contact with a phone number from the phone. Returns null when
 * the person says no to the permission. Read on the phone; only the friends
 * they then tick are sent to Hisaab.
 */
export async function readDeviceContacts(): Promise<RawContact[] | null> {
  const permission = await Contacts.requestPermissions()
  if (permission.contacts !== 'granted' && permission.contacts !== 'limited') return null
  const { contacts } = await Contacts.getContacts({ projection: { name: true, phones: true } })
  return contacts
    .map((c) => {
      const name = c.name?.display ?? [c.name?.given, c.name?.family].filter(Boolean).join(' ')
      const phones = [...(c.phones ?? [])]
        .sort((a, b) => Number(MOBILE.has(b.type)) - Number(MOBILE.has(a.type)))
        .map((p) => p.number ?? '')
        .filter(Boolean)
      return { name: name ?? '', phones }
    })
    .filter((c) => c.phones.length > 0)
}
