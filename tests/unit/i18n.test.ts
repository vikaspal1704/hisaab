import { describe, expect, it } from 'vitest'
import { translate } from '../../src/lib/i18n'
import { HINGLISH } from '../../src/lib/hinglish'

describe('translate', () => {
  it('fills placeholders and falls back to English', () => {
    expect(translate('en', 'Hi {name}', { name: 'Rahul' })).toBe('Hi Rahul')
    expect(translate('hi', 'Some untranslated text')).toBe('Some untranslated text')
  })

  it('keeps every placeholder in each translation', () => {
    for (const [en, hi] of Object.entries(HINGLISH)) {
      const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
      expect(placeholders(hi), en).toEqual(placeholders(en))
    }
  })
})
