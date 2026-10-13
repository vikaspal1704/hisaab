import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { Page } from '../components/Page'
import { useToast } from '../components/Toast'
import { Button, ErrorView, LoadingView } from '../components/ui'
import { useGroups, usePeople, usePersonLedger } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { todayISO } from '../lib/format'
import { useT } from '../lib/i18n'
import { formatINR } from '../lib/money'
import { isNativeApp, shareFile } from '../lib/native'
import { friendStatement, groupStatement, statementFileName, toCsv, type Cell, type Statement } from '../lib/statement'

/** A printable, downloadable statement for one friend (/statement/p/:id) or group (/statement/g/:id). */
export function StatementPage() {
  const { kind, id = '' } = useParams()
  const { t } = useT()
  const people = usePeople()
  const groups = useGroups()
  const ledger = usePersonLedger(id, kind === 'p')
  const groupRows = useQuery({ queryKey: ['group-statement', id], queryFn: () => api.groupStatement(id), enabled: kind === 'g' })
  const source = kind === 'g' ? groupRows : ledger

  const statement = useMemo((): Statement | null => {
    const common = { t, formatMoney: (p: number) => formatINR(p), today: todayISO() }
    if (kind === 'p') {
      const person = people.byId.get(id)
      return person && ledger.data ? friendStatement({ name: person.display_name, rows: ledger.data, ...common }) : null
    }
    const group = groups.data?.find((g) => g.id === id)
    if (!group || !groupRows.data) return null
    // Real names, not "You": the file is often sent on to others.
    const members = group.memberIds.map((m) => ({ id: m, name: people.name(m, { you: false }) }))
    return groupStatement({ groupName: group.name, members, rows: groupRows.data, ...common })
  }, [kind, id, t, people, groups.data, ledger.data, groupRows.data])

  if (source.error) return <Page title={t('Statement')} back><ErrorView message={friendlyError(source.error)} onRetry={() => source.refetch()} /></Page>
  if (source.isPending || people.isPending || groups.isPending) return <Page title={t('Statement')} back><LoadingView /></Page>
  if (!statement) return <Page title={t('Statement')} back><ErrorView message={t('Nothing to export here.')} /></Page>
  return <StatementView statement={statement} />
}

function StatementView({ statement }: { statement: Statement }) {
  const { t } = useT()
  const toast = useToast()
  const fileName = statementFileName(statement.title, todayISO(), 'csv')

  const csvFile = () => new File([toCsv(statement)], fileName, { type: 'text/csv' })
  const download = () => {
    if (isNativeApp()) {
      void shareFile(fileName, toCsv(statement), 'utf8', statement.title).catch(() => toast(t('Couldn’t share — try Download instead')))
      return
    }
    const url = URL.createObjectURL(csvFile())
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const canShareFile = typeof navigator.canShare === 'function' && navigator.canShare({ files: [csvFile()] })
  const share = async () => {
    try {
      await navigator.share({ files: [csvFile()], title: statement.title })
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast(t('Couldn’t share — try Download instead'))
    }
  }

  return (
    <Page title={t('Statement')} back wide>
      <div className="mt-2 grid grid-cols-2 gap-2 print:hidden lg:mt-0 lg:flex lg:justify-end">
        {isNativeApp() ? null : <Button onClick={() => window.print()}>📄 {t('Save as PDF')}</Button>}
        <Button variant="secondary" onClick={download}>⬇️ {t('Download CSV')}</Button>
        {canShareFile ? (
          <Button variant="ghost" className="col-span-2" onClick={share}>
            {t('Send the CSV (WhatsApp, email…)')}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-slate-500 print:hidden">
        {t('“Save as PDF”: pick “Save as PDF” as the printer. CSV opens in Excel or Google Sheets.')}
      </p>

      {/* The document itself: always black on white, like the printout. */}
      <article className="mt-4 rounded-2xl bg-white p-4 text-slate-900 ring-1 ring-slate-200 print:mt-0 print:p-0 print:ring-0">
        <header className="border-b border-slate-200 pb-3">
          <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">Hisaab</p>
          <h2 className="mt-1 text-xl font-bold">{statement.title}</h2>
          <p className="text-sm text-slate-500">{statement.subtitle}</p>
          {statement.summary.map((line) => (
            <p key={line} className="mt-1 font-semibold">{line}</p>
          ))}
        </header>
        {statement.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">{t('No entries yet')}</p>
        ) : (
          <>
          {statement.columns.length > 4 ? <p className="mt-2 text-xs text-slate-400 print:hidden">{t('Swipe the table sideways to see every column →')}</p> : null}
          <div className="-mx-4 overflow-x-auto px-4 print:mx-0 print:overflow-visible print:px-0">
            <table className="mt-3 w-full border-collapse text-xs">
              <thead>
                <tr>
                  {statement.columns.map((c, i) => (
                    <th key={i} className={`border-b border-slate-300 px-2 py-1.5 font-semibold whitespace-nowrap ${i >= 3 ? 'text-right' : 'text-left'}`}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statement.rows.map((row, r) => (
                  <tr key={r} className="border-b border-slate-100 break-inside-avoid">
                    {row.map((cell, i) => (
                      <td key={i} className={`px-2 py-1.5 align-top ${typeof cell !== 'string' ? 'text-right whitespace-nowrap tabular-nums' : i === 0 ? 'whitespace-nowrap' : 'min-w-28'}`}>
                        <CellText cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        <p className="mt-4 text-[10px] text-slate-400">{t('Amounts in ₹. “+” means money owed to that person.')}</p>
      </article>
    </Page>
  )
}

function CellText({ cell }: { cell: Cell }) {
  if (typeof cell === 'string') return <>{cell}</>
  if (cell.signed && cell.paise === 0) return <span className="text-slate-400">—</span>
  return <>{formatINR(cell.paise, { signed: cell.signed })}</>
}
