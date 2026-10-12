import type { Paise } from './money'

/** A cell is text, or money (kept in paise so CSV and screen can format it their own way). */
export type Cell = string | { paise: Paise; signed?: boolean }

export interface Statement {
  title: string
  subtitle: string
  columns: string[]
  rows: Cell[][]
  /** closing line(s), e.g. "Rahul owes you ₹450" */
  summary: string[]
}

/** Paise as a plain rupee number for spreadsheets: 12350 → "123.50". */
function rupees(paise: Paise): string {
  return (paise / 100).toFixed(2)
}

/**
 * Text a spreadsheet won't run as a formula (=, +, -, @ at the start), with
 * quotes escaped. Money is written as a bare number so it adds up.
 */
function csvCell(cell: Cell): string {
  if (typeof cell !== 'string') return rupees(cell.paise)
  const safe = /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** CSV with a BOM so Excel opens ₹ and Hindi names correctly. */
export function toCsv(statement: Statement): string {
  const lines = [statement.columns, ...statement.rows].map((row) => row.map(csvCell).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** "2026-10-12" → "12 Oct 2026", independent of the device's time zone. */
export function statementDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** A file name like "hisaab-rahul-2026-10-12.csv". */
export function statementFileName(title: string, today: string, ext: 'csv'): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `hisaab-${slug || 'statement'}-${today}.${ext}`
}

type Translate = (text: string, vars?: Record<string, string | number>) => string

const KIND_LABEL: Record<string, string> = { expense: 'Expense', payment: 'Payment', forgive: 'Chhod diya', treat: 'Treat' }

/** One friend's passbook. Positive amounts mean the friend owes me. */
export function friendStatement(args: {
  name: string
  rows: { occurred_on: string; description: string; kind: string; amount: Paise; delta: Paise; running: Paise }[]
  t: Translate
  formatMoney: (paise: Paise) => string
  today: string
}): Statement {
  const { name, rows, t, formatMoney, today } = args
  const balance = rows.length > 0 ? rows[rows.length - 1].running : 0
  return {
    title: t('You & {name}', { name }),
    subtitle: t('Statement as of {date}', { date: statementDate(today) }),
    columns: [t('Date'), t('Description'), t('Type'), t('Bill'), t('Effect (+ = {name} owes you)', { name }), t('Balance (+ = {name} owes you)', { name })],
    rows: rows.map((r) => [
      statementDate(r.occurred_on),
      r.description,
      t(KIND_LABEL[r.kind] ?? r.kind),
      { paise: r.amount },
      { paise: r.delta, signed: true },
      { paise: r.running, signed: true },
    ]),
    summary: [
      balance === 0
        ? t('All square')
        : balance > 0
          ? t('{name} owes you {amount}', { name, amount: formatMoney(balance) })
          : t('You owe {name} {amount}', { name, amount: formatMoney(-balance) }),
    ],
  }
}

/** A group's entries with what each did to every member. Positive = that member is owed more. */
export function groupStatement(args: {
  groupName: string
  members: { id: string; name: string }[]
  rows: { occurred_on: string; description: string; kind: string; amount: Paise; payers: Record<string, Paise>; effects: Record<string, Paise> }[]
  t: Translate
  formatMoney: (paise: Paise) => string
  today: string
}): Statement {
  const { groupName, members, rows, t, formatMoney, today } = args
  const nameOf = new Map(members.map((m) => [m.id, m.name]))
  const totals = new Map(members.map((m) => [m.id, 0]))
  for (const r of rows) for (const [id, net] of Object.entries(r.effects)) totals.set(id, (totals.get(id) ?? 0) + Number(net))
  const paidBy = (payers: Record<string, Paise>) => {
    const list = Object.entries(payers)
    if (list.length === 1) return nameOf.get(list[0][0]) ?? t('Someone')
    return list.map(([id, paise]) => `${nameOf.get(id) ?? t('Someone')} ${formatMoney(Number(paise))}`).join(', ')
  }
  return {
    title: groupName,
    subtitle: t('Statement as of {date}', { date: statementDate(today) }),
    columns: [t('Date'), t('Description'), t('Type'), t('Amount'), t('Paid by'), ...members.map((m) => m.name)],
    rows: [
      ...rows.map((r): Cell[] => [
        statementDate(r.occurred_on),
        r.description,
        t(KIND_LABEL[r.kind] ?? r.kind),
        { paise: r.amount },
        paidBy(r.payers),
        ...members.map((m) => ({ paise: Number(r.effects[m.id] ?? 0), signed: true })),
      ]),
      ['', t('Balance'), '', '', '', ...members.map((m) => ({ paise: totals.get(m.id) ?? 0, signed: true }))],
    ],
    summary: members
      .filter((m) => (totals.get(m.id) ?? 0) !== 0)
      .map((m) => {
        const net = totals.get(m.id)!
        return net > 0
          ? t('{name} gets back {amount}', { name: m.name, amount: formatMoney(net) })
          : t('{name} is behind by {amount}', { name: m.name, amount: formatMoney(-net) })
      }),
  }
}
