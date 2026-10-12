import { describe, expect, it } from 'vitest'
import { translate } from '../../src/lib/i18n'
import { formatINR } from '../../src/lib/money'
import { friendStatement, groupStatement, statementDate, statementFileName, toCsv } from '../../src/lib/statement'

const t = (text: string, vars?: Record<string, string | number>) => translate('en', text, vars)
const common = { t, formatMoney: (p: number) => formatINR(p), today: '2026-10-12' }

describe('friendStatement', () => {
  const rows = [
    { occurred_on: '2026-10-01', description: 'Dinner', kind: 'expense', amount: 90000, delta: 45000, running: 45000 },
    { occurred_on: '2026-10-05', description: 'Paid back', kind: 'payment', amount: 20000, delta: -20000, running: 25000 },
  ]

  it('lists the passbook with a running balance and a closing line', () => {
    const s = friendStatement({ name: 'Rahul', rows, ...common })
    expect(s.title).toBe('You & Rahul')
    expect(s.columns[4]).toBe('Effect (+ = Rahul owes you)')
    expect(s.rows[1]).toEqual(['05 Oct 2026', 'Paid back', 'Payment', { paise: 20000 }, { paise: -20000, signed: true }, { paise: 25000, signed: true }])
    expect(s.summary).toEqual(['Rahul owes you ₹250'])
    expect(friendStatement({ name: 'Rahul', rows: [], ...common }).summary).toEqual(['All square'])
  })

  it('writes a CSV spreadsheets can add up and can’t be tricked by', () => {
    const csv = toCsv(
      friendStatement({
        name: 'Rahul',
        rows: [{ occurred_on: '2026-10-01', description: '=HYPERLINK("x"), "quoted"', kind: 'expense', amount: 12345, delta: -6173, running: -6173 }],
        ...common,
      }),
    )
    expect(csv.startsWith('﻿')).toBe(true)
    const [header, row] = csv.slice(1).trimEnd().split('\r\n')
    expect(header).toBe('Date,Description,Type,Bill,Effect (+ = Rahul owes you),Balance (+ = Rahul owes you)')
    expect(row).toBe(`01 Oct 2026,"'=HYPERLINK(""x""), ""quoted""",Expense,123.45,-61.73,-61.73`)
  })
})

describe('groupStatement', () => {
  it('shows each member’s effect per entry and a balance row that adds to zero', () => {
    const members = [
      { id: 'a', name: 'Asha' },
      { id: 'b', name: 'Bilal' },
      { id: 'c', name: 'Chetan' },
    ]
    const s = groupStatement({
      groupName: 'Goa',
      members,
      rows: [
        { occurred_on: '2026-10-01', description: 'Villa', kind: 'expense', amount: 30000, payers: { a: 30000 }, effects: { a: 20000, b: -10000, c: -10000 } },
        { occurred_on: '2026-10-02', description: 'Fuel', kind: 'expense', amount: 6000, payers: { b: 3000, c: 3000 }, effects: { a: -2000, b: 1000, c: 1000 } },
      ],
      ...common,
    })
    expect(s.columns).toEqual(['Date', 'Description', 'Type', 'Amount', 'Paid by', 'Asha', 'Bilal', 'Chetan'])
    expect(s.rows[0][4]).toBe('Asha')
    expect(s.rows[1][4]).toBe('Bilal ₹30, Chetan ₹30')
    const balance = s.rows[2].slice(5).map((c) => (typeof c === 'string' ? 0 : c.paise))
    expect(balance).toEqual([18000, -9000, -9000])
    expect(balance.reduce((x, y) => x + y, 0)).toBe(0)
    expect(s.summary).toEqual(['Asha gets back ₹180', 'Bilal is behind by ₹90', 'Chetan is behind by ₹90'])
  })
})

describe('helpers', () => {
  it('formats dates without time-zone drift and makes safe file names', () => {
    expect(statementDate('2026-01-31')).toBe('31 Jan 2026')
    expect(statementFileName('You & Rahul Verma', '2026-10-12', 'csv')).toBe('hisaab-you-rahul-verma-2026-10-12.csv')
    expect(statementFileName('राहुल', '2026-10-12', 'csv')).toBe('hisaab-statement-2026-10-12.csv')
  })
})
