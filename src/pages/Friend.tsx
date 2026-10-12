import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { IconEdit, IconSwap, IconWhatsApp } from '../components/icons'
import { toneClass } from '../components/Money'
import { HeaderButton, Page } from '../components/Page'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { Button, ButtonLink, Card, EmptyState, ErrorView, Field, LoadingView, SectionTitle, TextInput } from '../components/ui'
import { useBalances, useHouseholdOf, useLedgerMutation, usePeople, usePersonLedger } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { formatDay, formatMonth } from '../lib/format'
import { formatINR } from '../lib/money'
import { formatPhone } from '../lib/phone'
import { inviteText, reminderText, whatsappLink } from '../lib/share'
import type { LedgerRow } from '../lib/types'

export function FriendPage() {
  const { id = '' } = useParams()
  const people = usePeople()
  const balances = useBalances()
  const ledger = usePersonLedger(id)
  const householdOf = useHouseholdOf()
  const [renaming, setRenaming] = useState(false)

  const person = people.byId.get(id)
  const net = balances.net(id)
  const household = householdOf.get(id)

  const months = useMemo(() => {
    const groups: { month: string; rows: LedgerRow[] }[] = []
    for (const row of [...(ledger.data ?? [])].reverse()) {
      const month = formatMonth(row.occurred_on)
      const last = groups[groups.length - 1]
      if (last?.month === month) last.rows.push(row)
      else groups.push({ month, rows: [row] })
    }
    return groups
  }, [ledger.data])

  if (people.isPending || ledger.isPending) return <Page title="" back><LoadingView /></Page>
  if (!person) return <Page title="" back><ErrorView message="This person isn’t in your contacts." /></Page>
  if (ledger.error) return <Page title={person.display_name} back><ErrorView message={friendlyError(ledger.error)} onRetry={() => ledger.refetch()} /></Page>

  const myUpi = people.me?.upi_id ?? null

  return (
    <Page
      title={person.display_name}
      back
      actions={
        person.is_contact ? (
          <HeaderButton label="Rename" onClick={() => setRenaming(true)}>
            <IconEdit />
          </HeaderButton>
        ) : undefined
      }
      footer={
        <div className="flex gap-3 pb-1">
          <ButtonLink to={`/add?with=${id}`} variant="secondary" className="flex-1">Add expense</ButtonLink>
          <ButtonLink to={`/settle/person/${id}`} className="flex-1"><IconSwap size={18} /> Settle up</ButtonLink>
        </div>
      }
    >
      <div className="flex flex-col items-center pt-2 text-center">
        <Avatar id={person.id} name={person.display_name} size={72} />
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{formatPhone(person.phone)}</p>
        <p className={`mt-3 text-2xl font-bold ${toneClass(net)}`}>
          {net > 0 ? `Owes you ${formatINR(net)}` : net < 0 ? `You owe ${formatINR(-net)}` : 'All square'}
        </p>
        {net < 0 ? (
          <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">Pay the next bill with {person.display_name} and it evens out.</p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {!person.is_registered ? (
            <a
              href={whatsappLink(person.phone, inviteText(person.display_name))}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#25D366]/15 px-4 text-sm font-semibold text-[#128C7E] dark:text-[#25D366]"
            >
              <IconWhatsApp size={18} /> Invite to Hisaab
            </a>
          ) : null}
          {net > 0 ? (
            <a
              href={whatsappLink(person.phone, reminderText(person.display_name, net, myUpi))}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-slate-200/70 px-4 text-sm font-semibold dark:bg-slate-800"
            >
              <IconWhatsApp size={18} /> Send a reminder
            </a>
          ) : null}
        </div>
        {household ? (
          <Link to={`/h/${household.id}`} className="mt-3 text-sm font-medium text-brand-700 dark:text-brand-500">
            Part of “{household.name}” →
          </Link>
        ) : null}
      </div>

      {months.length === 0 ? (
        <EmptyState title="No entries yet" body={`When you or ${person.display_name} add an expense, it shows up here with a running balance.`} />
      ) : (
        months.map((m) => (
          <section key={m.month}>
            <SectionTitle>{m.month}</SectionTitle>
            <Card className="divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
              {m.rows.map((row) => (
                <PassbookRow key={row.entry_id} row={row} name={person.display_name} />
              ))}
            </Card>
          </section>
        ))
      )}

      <RenameSheet open={renaming} onClose={() => setRenaming(false)} personId={id} current={person.display_name} />
    </Page>
  )
}

function PassbookRow({ row, name }: { row: LedgerRow; name: string }) {
  const isPayment = row.kind === 'payment'
  const what = isPayment
    ? row.delta > 0
      ? `You paid ${name}`
      : `${name} paid you`
    : row.delta > 0
      ? `${name} owes you`
      : `You owe ${name}`
  return (
    <Link to={`/e/${row.entry_id}`} className="flex items-start gap-3 px-4 py-3 active:bg-slate-50 dark:active:bg-slate-800/60">
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-lg dark:bg-slate-800" aria-hidden>
        {isPayment ? '🤝' : '🧾'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{row.description}</span>
        <span className="block text-sm text-slate-500 dark:text-slate-400">
          {formatDay(row.occurred_on)} · {isPayment ? `${formatINR(row.amount)} payment` : `${formatINR(row.amount)} bill`}
        </span>
      </span>
      <span className="text-right">
        <span className={`block text-sm ${toneClass(row.delta)}`}>{what}</span>
        <span className={`block font-semibold tabular-nums ${toneClass(row.delta)}`}>{formatINR(Math.abs(row.delta))}</span>
        <span className="block text-xs text-slate-500 tabular-nums dark:text-slate-400">
          {row.running === 0
            ? 'Balance: settled'
            : row.running > 0
              ? `Balance: ${name} owes ${formatINR(row.running)}`
              : `Balance: you owe ${formatINR(-row.running)}`}
        </span>
      </span>
    </Link>
  )
}

function RenameSheet({ open, onClose, personId, current }: { open: boolean; onClose: () => void; personId: string; current: string }) {
  const [value, setValue] = useState(current)
  const toast = useToast()
  const mutation = useLedgerMutation((nickname: string) => api.setNickname(personId, nickname))
  return (
    <Sheet open={open} onClose={onClose} title="Rename">
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Only you see this name.</p>
      <Field label="Name" error={mutation.error ? friendlyError(mutation.error) : null}>
        <TextInput value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} autoFocus />
      </Field>
      <Button
        block
        className="mt-4"
        busy={mutation.isPending}
        disabled={!value.trim()}
        onClick={() =>
          mutation.mutate(value.trim(), {
            onSuccess: () => {
              toast('Renamed')
              onClose()
            },
          })
        }
      >
        Save
      </Button>
    </Sheet>
  )
}
