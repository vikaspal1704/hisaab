import { describe, expect, it } from 'vitest'
import { parseContactsCsv, parseContactsFile, parseVCard, toCandidates } from '../../src/lib/contactsImport'

const VCF = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Verma;Rahul;;;',
  'FN:Rahul Verma',
  'TEL;TYPE=WORK:080 2222 3333',
  'item1.TEL;TYPE=CELL:+91 98222 22222',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:2.1',
  'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;=E0=A4=85=E0=A4=AE=E0=A4=BF=E0=A4=A4;;;',
  'TEL;CELL:09833333333',
  'END:VCARD',
  'BEGIN:VCARD',
  'FN:Long',
  '  Name',
  'TEL;VALUE=uri:tel:+919844444444',
  'END:VCARD',
  'BEGIN:VCARD',
  'FN:No Phone',
  'EMAIL:x@example.com',
  'END:VCARD',
].join('\r\n')

describe('parseVCard', () => {
  it('reads iPhone, Android and Google exports', () => {
    expect(parseVCard(VCF)).toEqual([
      { name: 'Rahul Verma', phones: ['+91 98222 22222', '080 2222 3333'] },
      { name: 'अमित', phones: ['09833333333'] },
      { name: 'Long Name', phones: ['+919844444444'] },
    ])
  })
})

describe('parseContactsCsv', () => {
  it('reads Google Contacts exports with several numbers per cell', () => {
    const csv = [
      'First Name,Middle Name,Last Name,Phone 1 - Label,Phone 1 - Value,Phone 2 - Label,Phone 2 - Value',
      'Neha,,Shah,Mobile,"+91 98444 44444 ::: 080 1111 2222",,',
      '"Kabir, Jr.",,,Home,,Mobile,9855555555',
    ].join('\n')
    expect(parseContactsCsv(csv)).toEqual([
      { name: 'Neha Shah', phones: ['+91 98444 44444', '080 1111 2222'] },
      { name: 'Kabir, Jr.', phones: ['9855555555'] },
    ])
  })

  it('reads a simple name/phone sheet and picks the format by content', () => {
    expect(parseContactsFile('friends.csv', 'Name,Phone\nZoya,9866666666\n')).toEqual([{ name: 'Zoya', phones: ['9866666666'] }])
    expect(parseContactsFile('contacts.vcf', VCF)).toHaveLength(3)
  })
})

describe('toCandidates', () => {
  it('keeps one valid mobile number per contact and marks who is already added', () => {
    const rows = toCandidates(parseVCard(VCF), { myPhone: '+919844444444', existingPhones: new Set(['+919822222222']) })
    expect(rows).toEqual([
      { name: 'Long Name', phone: '+919844444444', status: 'me' },
      { name: 'Rahul Verma', phone: '+919822222222', status: 'existing' },
      { name: 'अमित', phone: '+919833333333', status: 'new' },
    ])
  })

  it('skips landlines and duplicates', () => {
    const rows = toCandidates(
      [
        { name: 'Office', phones: ['022 2222 3333'] },
        { name: 'Asha', phones: ['98777 77777'] },
        { name: 'Asha again', phones: ['+919877777777'] },
      ],
      { myPhone: '', existingPhones: new Set() },
    )
    expect(rows).toEqual([{ name: 'Asha', phone: '+919877777777', status: 'new' }])
  })
})
