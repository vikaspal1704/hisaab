import { describe, expect, it } from 'vitest'
import { toCandidates } from '../../src/lib/contactsImport'
import { toRawContacts } from '../../src/lib/googleContacts'

describe('toRawContacts (Google People API)', () => {
  it('prefers mobile numbers, uses the canonical form, and skips people without numbers', () => {
    const raw = toRawContacts({
      connections: [
        { names: [{ displayName: 'Rahul Verma' }], phoneNumbers: [{ value: '022 2222 3333', type: 'work' }, { value: '98765 43210', canonicalForm: '+919876543210', type: 'mobile' }] },
        { names: [{ displayName: 'Email only' }] },
        { phoneNumbers: [{ value: '+91 99887 76655' }] },
      ],
    })
    expect(raw).toEqual([
      { name: 'Rahul Verma', phones: ['+919876543210', '022 2222 3333'] },
      { name: '', phones: ['+91 99887 76655'] },
    ])
    expect(toCandidates(raw, { myPhone: '', existingPhones: new Set() }).map((c) => c.name)).toEqual(['+919988776655', 'Rahul Verma'])
  })
})
