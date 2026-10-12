import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from '../../src/lib/quickAdd'

describe('parseQuickAdd', () => {
  it.each([
    ['450 chai', { amount: 45000, description: 'chai' }],
    ['chai 450', { amount: 45000, description: 'chai' }],
    ['₹1,200 dinner at Toit', { amount: 120000, description: 'dinner at Toit' }],
    ['dinner Rs. 1200.50', { amount: 120050, description: 'dinner' }],
    ['90 for samosa', { amount: 9000, description: 'samosa' }],
    ['just text', { amount: null, description: 'just text' }],
    ['0 chai', { amount: null, description: 'chai' }],
  ])('%s', (input, expected) => expect(parseQuickAdd(input)).toEqual(expected))
})
