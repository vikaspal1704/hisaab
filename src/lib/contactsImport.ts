import { normalizePhone } from './phone'

/** A contact as read from a phone or file, before cleaning. */
export interface RawContact {
  name: string
  /** All numbers, mobile numbers first. */
  phones: string[]
}

export interface ImportCandidate {
  name: string
  phone: string
  status: 'new' | 'existing' | 'me'
}

function decodeQuotedPrintable(value: string): string {
  const bytes: number[] = []
  const text = value.replace(/=\r?\n/g, '')
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '=' && /^[0-9A-F]{2}$/i.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      bytes.push(...new TextEncoder().encode(text[i]))
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

const unescapeVCard = (value: string) => value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()

/**
 * Reads a .vcf file (iPhone, Android, Google Contacts exports). Handles
 * folded lines, "item1.TEL" groups, tel: URIs and quoted-printable names
 * from older Android phones.
 */
export function parseVCard(text: string): RawContact[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const contacts: RawContact[] = []
  let current: { fn: string; n: string; mobile: string[]; other: string[] } | null = null

  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const rawKey = line.slice(0, colon)
    let value = line.slice(colon + 1)
    const [prop, ...params] = rawKey.replace(/^item\d+\./i, '').split(';')
    const key = prop.toUpperCase()
    const paramText = params.join(';').toUpperCase()
    if (paramText.includes('QUOTED-PRINTABLE')) value = decodeQuotedPrintable(value)

    if (key === 'BEGIN' && value.trim().toUpperCase() === 'VCARD') current = { fn: '', n: '', mobile: [], other: [] }
    else if (!current) continue
    else if (key === 'FN') current.fn = unescapeVCard(value)
    else if (key === 'N') {
      const [family = '', given = '', middle = ''] = value.split(';').map(unescapeVCard)
      current.n = [given, middle, family].filter(Boolean).join(' ')
    } else if (key === 'TEL') {
      const number = value.replace(/^tel:/i, '').trim()
      if (/CELL|MOBILE|IPHONE/.test(paramText)) current.mobile.push(number)
      else current.other.push(number)
    } else if (key === 'END' && value.trim().toUpperCase() === 'VCARD') {
      const name = current.fn || current.n
      const phones = [...current.mobile, ...current.other]
      if (phones.length) contacts.push({ name, phones })
      current = null
    }
  }
  return contacts
}

/** Minimal RFC 4180 CSV reader (quoted fields, escaped quotes, newlines in quotes). */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.replace(/^﻿/, '')
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim()))
}

/**
 * Reads a contacts .csv: Google Contacts ("First Name", "Phone 1 - Value"),
 * Outlook ("Mobile Phone") or any sheet with name and phone columns.
 */
export function parseContactsCsv(text: string): RawContact[] {
  const [header, ...rows] = parseCsvRows(text)
  if (!header) return []
  const cols = header.map((h) => h.trim().toLowerCase())
  const find = (...names: string[]) => cols.findIndex((c) => names.includes(c))
  const nameCol = find('name', 'full name', 'display name', 'contact name')
  const firstCol = find('first name', 'given name')
  const middleCol = find('middle name', 'additional name')
  const lastCol = find('last name', 'family name')
  const phoneCols = cols
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => /phone|mobile|number|tel/.test(c) && !/type|label/.test(c))
    // Mobile columns first.
    .sort((a, b) => Number(/mobile|cell/.test(b.c)) - Number(/mobile|cell/.test(a.c)))
    .map(({ i }) => i)

  return rows
    .map((r) => {
      const name =
        (nameCol >= 0 && r[nameCol]?.trim()) ||
        [firstCol, middleCol, lastCol]
          .filter((i) => i >= 0)
          .map((i) => r[i]?.trim())
          .filter(Boolean)
          .join(' ')
      // Google puts several numbers in one cell separated by " ::: ".
      const phones = phoneCols.flatMap((i) => (r[i] ?? '').split(':::').map((p) => p.trim())).filter(Boolean)
      return { name, phones }
    })
    .filter((c) => c.phones.length > 0)
}

export function parseContactsFile(fileName: string, text: string): RawContact[] {
  return /\.csv$/i.test(fileName) || (!/BEGIN:VCARD/i.test(text) && text.includes(','))
    ? parseContactsCsv(text)
    : parseVCard(text)
}

/**
 * Cleans raw contacts into importable rows: the first valid mobile number per
 * contact, one row per number, sorted by name, marked if already a friend.
 */
export function toCandidates(raw: RawContact[], opts: { myPhone: string; existingPhones: Set<string> }): ImportCandidate[] {
  const byPhone = new Map<string, ImportCandidate>()
  for (const contact of raw) {
    const phone = contact.phones.map((p) => normalizePhone(p)).find((p): p is string => Boolean(p))
    if (!phone || byPhone.has(phone)) continue
    const name = (contact.name.trim() || phone).slice(0, 60)
    const status = phone === opts.myPhone ? 'me' : opts.existingPhones.has(phone) ? 'existing' : 'new'
    byPhone.set(phone, { name, phone, status })
  }
  return [...byPhone.values()].sort((a, b) => a.name.localeCompare(b.name))
}
