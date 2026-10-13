import type { RawContact } from './contactsImport'
import { isNativeApp } from './native'

/**
 * "Connect Google Contacts": reads the address book saved in your Google
 * account (where most Android phones keep contacts) right in the browser, with
 * a short-lived read-only token that is revoked as soon as the list is read.
 * Nothing is stored except the friends you then choose to add.
 */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const SCOPE = 'https://www.googleapis.com/auth/contacts.readonly'
const LAST_SYNC = 'hisaab.googleContactsSyncedAt'

interface TokenResponse {
  access_token?: string
  error?: string
}
interface GoogleOAuth {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type: string }) => void
  }): { requestAccessToken(options?: { prompt?: string }): void }
  revoke(token: string, done?: () => void): void
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth } }
  }
}

/** Shown only when a client ID is configured, and not inside the Android app (it reads the phone directly). */
export const googleContactsAvailable = Boolean(CLIENT_ID) && !isNativeApp()

let loading: Promise<void> | null = null
/** Loads Google's sign-in script ahead of the tap, so the consent popup isn't blocked. */
export function prepareGoogleContacts(): Promise<void> {
  if (!googleContactsAvailable) return Promise.resolve()
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      loading = null
      reject(new Error('google_script'))
    }
    document.head.appendChild(script)
  })
  return loading
}

/** Must be called straight from a tap. Resolves with the contacts, or null if the person cancelled. */
export function readGoogleContacts(): Promise<RawContact[] | null> {
  const oauth = window.google?.accounts?.oauth2
  if (!CLIENT_ID || !oauth) return Promise.reject(new Error('google_not_ready'))
  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: async (response) => {
        if (!response.access_token) return resolve(null)
        try {
          const contacts = await fetchAll(response.access_token)
          try {
            localStorage.setItem(LAST_SYNC, new Date().toISOString())
          } catch {
            // not important
          }
          resolve(contacts)
        } catch (error) {
          reject(error)
        } finally {
          oauth.revoke(response.access_token)
        }
      },
      error_callback: () => resolve(null),
    })
    client.requestAccessToken({ prompt: '' })
  })
}

export interface PeopleResponse {
  connections?: { names?: { displayName?: string }[]; phoneNumbers?: { value?: string; canonicalForm?: string; type?: string }[] }[]
  nextPageToken?: string
}

async function fetchAll(token: string): Promise<RawContact[]> {
  const contacts: RawContact[] = []
  let pageToken = ''
  for (let page = 0; page < 20; page++) {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections')
    url.searchParams.set('personFields', 'names,phoneNumbers')
    url.searchParams.set('pageSize', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`google_contacts_${res.status}`)
    const data = (await res.json()) as PeopleResponse
    contacts.push(...toRawContacts(data))
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return contacts
}

/** One page of Google contacts as import rows: mobile numbers first, people without numbers skipped. */
export function toRawContacts(data: PeopleResponse): RawContact[] {
  const contacts: RawContact[] = []
  for (const person of data.connections ?? []) {
    const numbers = [...(person.phoneNumbers ?? [])].sort((a, b) => Number(b.type === 'mobile') - Number(a.type === 'mobile'))
    const phones = numbers.map((n) => n.canonicalForm ?? n.value ?? '').filter(Boolean)
    if (phones.length) contacts.push({ name: person.names?.[0]?.displayName ?? '', phones })
  }
  return contacts
}

/** When Google Contacts were last read on this device, if ever. */
export function lastGoogleSync(): Date | null {
  try {
    const value = localStorage.getItem(LAST_SYNC)
    return value ? new Date(value) : null
  } catch {
    return null
  }
}
