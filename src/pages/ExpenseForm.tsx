import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Avatar, AvatarStack } from '../components/Avatar'
import { IconPlus, IconX } from '../components/icons'
import { ItemsEditor, newItem, type ExtrasDraft, type ItemDraft } from '../components/ItemsEditor'
import { Page } from '../components/Page'
import { CheckRow, InlineAddFriend, SearchBox } from '../components/PeoplePicker'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { Button, Card, ErrorView, Field, inputClass, LoadingView, Segmented, SectionTitle } from '../components/ui'
import { keys, useBalances, useEntry, useGroups, useHouseholds, useLedgerMutation, usePeople, useShortcuts } from '../hooks/queries'
import { api } from '../lib/api'
import { friendlyError, InputError } from '../lib/errors'
import { todayISO } from '../lib/format'
import { useT } from '../lib/i18n'
import { matchPayee, parsePaymentText } from '../lib/paymentText'
import { formatINR, parseRupees, toRupeeInput, type Paise } from '../lib/money'
import { whoPaysNext } from '../lib/settle'
import { fromStoredItems, splitItems, toStoredItems, type BillExtras, type BillLine } from '../lib/itemSplit'
import { buildSplit, splitByWeights, type SplitMode, type SplitUnit } from '../lib/split'
import type { EntryDetail, Group, Household, Person, Shortcut } from '../lib/types'

const QUICK = ['🍕 Food', '🍻 Drinks', '☕ Coffee', '🚕 Cab', '🎬 Movie', '🛒 Groceries', '✈️ Trip', '🏠 Rent']

interface FormState {
  amountText: string
  description: string
  date: string
  groupId: string | null
  units: SplitUnit[]
  payerMode: 'one' | 'many'
  payerId: string
  payerAmounts: Record<string, string>
  mode: SplitMode
  values: Record<string, string>
  /** split by item: the bill's lines and charges */
  items: ItemDraft[]
  extras: ExtrasDraft
}

const NO_EXTRAS_TEXT: ExtrasDraft = { tax: '', tip: '', discount: '' }
const amountText = (paise: number) => (paise > 0 ? toRupeeInput(paise) : '')

const personUnit = (id: string): SplitUnit => ({ key: id, repId: id, memberIds: [id] })
const householdUnit = (h: Household, meId: string): SplitUnit => {
  const members = h.memberIds.filter((m) => m !== meId)
  return { key: `h:${h.id}`, repId: members[0], memberIds: members }
}

export function ExpenseFormPage() {
  const { id: entryId } = useParams()
  const [params] = useSearchParams()
  const { t } = useT()
  const people = usePeople()
  const households = useHouseholds()
  const groups = useGroups()
  const shortcuts = useShortcuts()
  const entry = useEntry(entryId)
  const copyId = params.get('copy') ?? undefined
  const copy = useEntry(copyId)

  const ready =
    people.me &&
    !households.isPending &&
    !groups.isPending &&
    (!entryId || !entry.isPending) &&
    (!copyId || !copy.isPending) &&
    (!params.get('shortcut') || !shortcuts.isPending)
  const title = entryId ? t('Edit expense') : t('Add expense')
  if (!ready) return <Page title={title} back><LoadingView /></Page>
  if (entryId && (!entry.data || entry.data.kind !== 'expense' || entry.data.deleted_at)) {
    return <Page title={title} back><ErrorView message={t('This expense can’t be edited.')} /></Page>
  }
  return (
    <ExpenseForm
      meId={people.me!.id}
      existing={entry.data ?? null}
      copyFrom={copy.data?.kind === 'expense' ? copy.data : null}
      shortcut={shortcuts.data?.find((s) => s.id === params.get('shortcut')) ?? null}
      people={people.list}
      households={households.data ?? []}
      groups={groups.data ?? []}
    />
  )
}

/** Form state that reproduces an existing expense (for editing or "add again"). */
function fromEntry(base: FormState, entry: EntryDetail, meId: string): FormState {
  const payers = entry.parts.filter((p) => p.paid > 0)
  const consumers = entry.parts.filter((p) => p.owed > 0 || entry.split_mode === 'shares')
  if (entry.split_mode === 'items' && entry.items) {
    const bill = fromStoredItems(entry.items)
    const ids = [...new Set([...consumers.map((p) => p.person_id), ...bill.personIds])]
    return {
      ...base,
      amountText: toRupeeInput(entry.amount),
      description: entry.description,
      groupId: entry.group_id,
      units: ids.map(personUnit),
      payerMode: payers.length > 1 ? 'many' : 'one',
      payerId: payers[0]?.person_id ?? meId,
      payerAmounts: Object.fromEntries(payers.map((p) => [p.person_id, toRupeeInput(p.paid)])),
      mode: 'items',
      items: bill.lines.map((l) => ({ key: l.key, name: l.name, amountText: toRupeeInput(l.amount), unitKeys: l.unitKeys })),
      extras: { tax: amountText(bill.extras.tax), tip: amountText(bill.extras.tip), discount: amountText(bill.extras.discount) },
    }
  }
  return {
    ...base,
    amountText: toRupeeInput(entry.amount),
    description: entry.description,
    groupId: entry.group_id,
    units: consumers.map((p) => personUnit(p.person_id)),
    payerMode: payers.length > 1 ? 'many' : 'one',
    payerId: payers[0]?.person_id ?? meId,
    payerAmounts: Object.fromEntries(payers.map((p) => [p.person_id, toRupeeInput(p.paid)])),
    // An itemised bill without its item list (e.g. paid from a kitty) edits as amounts.
    mode: entry.split_mode === 'items' || !entry.split_mode ? 'exact' : entry.split_mode,
    values: Object.fromEntries(
      consumers.map((p) => [p.person_id, entry.split_mode === 'shares' ? String(p.shares ?? 1) : toRupeeInput(p.owed)]),
    ),
  }
}

/** Applies a pasted UPI/bank message: amount, and the friend it went to if we recognise them. */
function applyPaste(state: FormState, text: string, people: Person[]): FormState {
  const parsed = parsePaymentText(text)
  const payee = matchPayee(parsed, people.filter((p) => p.is_contact && !p.is_me))
  const units = payee && !state.units.some((u) => u.memberIds.includes(payee.id)) ? [...state.units, personUnit(payee.id)] : state.units
  return {
    ...state,
    amountText: parsed.amount ? toRupeeInput(parsed.amount) : state.amountText,
    units,
    payerMode: 'one',
    payerId: state.units[0]?.repId ?? state.payerId,
  }
}

function initialState(args: {
  meId: string
  existing: EntryDetail | null
  copyFrom: EntryDetail | null
  shortcut: Shortcut | null
  people: Person[]
  households: Household[]
  groups: Group[]
  params: URLSearchParams
}): FormState {
  const { meId, existing, copyFrom, shortcut, people, households, groups, params } = args
  const base: FormState = {
    amountText: '',
    description: '',
    date: todayISO(),
    groupId: null,
    units: [personUnit(meId)],
    payerMode: 'one',
    payerId: meId,
    payerAmounts: {},
    mode: 'equal',
    values: {},
    items: [],
    extras: NO_EXTRAS_TEXT,
  }

  if (existing) return { ...fromEntry(base, existing, meId), date: existing.occurred_on }
  if (copyFrom) return fromEntry(base, copyFrom, meId)
  if (shortcut) {
    return {
      ...base,
      description: shortcut.description,
      amountText: shortcut.amount ? toRupeeInput(shortcut.amount) : '',
      groupId: shortcut.group_id,
      units: shortcut.units,
    }
  }

  const units = [...base.units]
  const add = (u: SplitUnit) => {
    if (!units.some((x) => x.key === u.key || x.memberIds.some((m) => u.memberIds.includes(m)))) units.push(u)
  }
  const group = groups.find((g) => g.id === params.get('group'))
  if (group) group.memberIds.filter((m) => m !== meId).forEach((m) => add(personUnit(m)))
  const household = households.find((h) => h.id === params.get('household'))
  if (household) add(householdUnit(household, meId))
  for (const id of (params.get('with') ?? '').split(',').filter(Boolean)) add(personUnit(id))
  const quickAmount = Number(params.get('amount'))
  const state = {
    ...base,
    groupId: group?.id ?? null,
    units,
    amountText: Number.isInteger(quickAmount) && quickAmount > 0 ? toRupeeInput(quickAmount) : '',
    description: params.get('desc') ?? '',
  }
  const pasted = params.get('paste')
  return pasted && pasted !== '1' ? applyPaste(state, pasted, people) : state
}

function ExpenseForm({
  meId,
  existing,
  copyFrom,
  shortcut,
  people: peopleList,
  households,
  groups,
}: {
  meId: string
  existing: EntryDetail | null
  copyFrom: EntryDetail | null
  shortcut: Shortcut | null
  people: Person[]
  households: Household[]
  groups: Group[]
}) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { t } = useT()
  const toast = useToast()
  const people = usePeople()
  const balances = useBalances()
  const [state, setState] = useState<FormState>(() =>
    initialState({ meId, existing, copyFrom, shortcut, people: peopleList, households, groups, params }),
  )
  const [picking, setPicking] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(params.get('paste') === '1')
  const [pasteText, setPasteText] = useState('')
  const [fromKitty, setFromKitty] = useState(false)
  const [saveShortcut, setSaveShortcut] = useState(false)
  // Most bills are "split equally, I paid": keep those controls out of the way until needed.
  const [advanced, setAdvanced] = useState(
    () => Boolean(existing) || state.mode !== 'equal' || state.payerMode !== 'one' || state.payerId !== meId,
  )
  const amountRef = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<FormState>) => setState((s) => ({ ...s, ...patch }))

  useEffect(() => {
    if (!existing) amountRef.current?.focus()
  }, [existing])

  const typedAmount: Paise | null = parseRupees(state.amountText)
  const byItem = state.mode === 'items'

  // Split by item: the total comes from the bill, and the typed amount is only a check.
  const bill = useMemo(() => {
    if (!byItem) return null
    const lines: BillLine[] = state.items.map((i) => ({ ...i, amount: i.amountText.trim() ? (parseRupees(i.amountText) ?? 0) : 0 }))
    const parse = (text: string) => (text.trim() ? parseRupees(text) : 0)
    const raw = { tax: parse(state.extras.tax), tip: parse(state.extras.tip), discount: parse(state.extras.discount) }
    const extras: BillExtras | null = raw.tax === null || raw.tip === null || raw.discount === null ? null : (raw as BillExtras)
    const result = extras ? splitItems(state.units, lines, extras) : { ok: false as const, error: 'Check the tax, tip and discount' }
    const subtotal = lines.reduce((s, l) => s + (l.amount > 0 ? l.amount : 0), 0)
    return { lines, extras, result, subtotal }
  }, [byItem, state.items, state.extras, state.units])
  const amount: Paise | null = bill ? (bill.result.ok ? bill.result.total : null) : typedAmount

  const group = groups.find((g) => g.id === state.groupId) ?? null
  const kittyHolder = !existing && group?.kittyHolder ? group.kittyHolder : null
  const useKitty = Boolean(kittyHolder && fromKitty)
  const unitLabel = (u: SplitUnit) =>
    u.key.startsWith('h:') ? (households.find((h) => `h:${h.id}` === u.key)?.name ?? t('Pair')) : people.name(u.repId)

  const payerCandidates = useMemo(() => {
    const ids = [meId, ...state.units.flatMap((u) => u.memberIds)]
    return [...new Set(ids)]
  }, [meId, state.units])

  const payers = useMemo((): Record<string, Paise> => {
    if (useKitty && kittyHolder) return amount ? { [kittyHolder]: amount } : {}
    if (state.payerMode === 'one') return amount ? { [state.payerId]: amount } : {}
    return Object.fromEntries(
      Object.entries(state.payerAmounts)
        .filter(([id]) => payerCandidates.includes(id))
        .map(([id, text]) => [id, parseRupees(text) ?? 0]),
    )
  }, [state.payerMode, state.payerId, state.payerAmounts, amount, payerCandidates, useKitty, kittyHolder])

  const split = useMemo(() => {
    if (bill) {
      if (!bill.result.ok) return bill.result
      return buildSplit({ amount: bill.result.total, mode: 'exact', units: state.units, values: bill.result.owedByUnit, payers })
    }
    if (!amount) return { ok: false as const, error: 'Enter an amount' }
    if (state.mode === 'items') return { ok: false as const, error: 'Enter an amount' } // unreachable: narrows the mode
    const values = Object.fromEntries(
      state.units.map((u) => {
        const raw = state.values[u.key] ?? ''
        return [u.key, state.mode === 'exact' ? (parseRupees(raw) ?? 0) : Number(raw) || 0]
      }),
    )
    return buildSplit({ amount, mode: state.mode, units: state.units, values, payers })
  }, [bill, amount, state.mode, state.units, state.values, payers])

  // Logging a bill between other people ("Rahul paid for Priya") is fine: I just don't share it.
  const iShare = state.units.some((u) => u.memberIds.includes(meId))
  const iPay = (payers[meId] ?? 0) > 0
  const myPart = split.ok ? split.parts.find((p) => p.person_id === meId) : undefined
  const myNet = myPart ? myPart.paid - myPart.owed : 0

  const save = useLedgerMutation(async () => {
    if (!split.ok || !amount) throw new InputError(t(split.ok ? 'Enter an amount' : split.error))
    const description = state.description.trim() || t('Expense')
    // A kitty spend keeps the amounts but not the item list.
    const splitMode = state.mode === 'items' ? 'exact' : state.mode
    const id =
      useKitty && state.groupId
        ? await api.saveKittyExpense({ description, amount, occurredOn: state.date, groupId: state.groupId, splitMode, parts: split.parts })
        : bill?.extras
          ? await api.saveItemizedExpense({
              entryId: existing?.id ?? null,
              description,
              occurredOn: state.date,
              groupId: state.groupId,
              parts: split.parts,
              items: toStoredItems(state.units, bill.lines, bill.extras),
              expectedVersion: existing?.version ?? null,
            })
          : await api.saveExpense({
            entryId: existing?.id ?? null,
            description,
            amount,
            occurredOn: state.date,
            groupId: state.groupId,
            splitMode,
            parts: split.parts,
            expectedVersion: existing?.version ?? null,
          })
    if (saveShortcut) await api.saveShortcut(description.slice(0, 40), description, amount, state.groupId, state.units)
    return id
  })

  const submit = () => {
    setSubmitted(true)
    if (!split.ok) return
    save.mutate(undefined, {
      onSuccess: (id) => {
        toast(existing ? t('Expense updated') : t('Expense added'))
        if (existing) navigate(-1)
        else navigate(`/e/${id}`, { replace: true })
      },
    })
  }

  const setMode = (mode: SplitMode) => {
    if (mode === 'items') {
      const items = state.items.length > 0 ? state.items : [newItem(state.units.map((u) => u.key))]
      return set({ mode, items })
    }
    // Leaving "by item" keeps the bill's total as the amount.
    const carry = byItem && amount ? { amountText: toRupeeInput(amount) } : {}
    let values: Record<string, string> = {}
    if (mode === 'shares') values = Object.fromEntries(state.units.map((u) => [u.key, String(u.memberIds.length)]))
    if (mode === 'exact' && amount && state.units.length > 0) {
      const parts = splitByWeights(amount, state.units.map((u) => u.memberIds.length))
      values = Object.fromEntries(state.units.map((u, i) => [u.key, toRupeeInput(parts[i])]))
    }
    set({ ...carry, mode, values })
  }

  const removeUnit = (key: string) => set({ units: state.units.filter((u) => u.key !== key) })

  const toggleUnit = (unit: SplitUnit) => {
    const exists = state.units.some((u) => u.key === unit.key)
    const units = exists
      ? state.units.filter((u) => u.key !== unit.key)
      : [...state.units.filter((u) => !u.memberIds.some((m) => unit.memberIds.includes(m))), unit]
    set({ units, values: { ...state.values, [unit.key]: state.mode === 'shares' ? String(unit.memberIds.length) : '' } })
  }

  const chooseGroup = (g: Group) => {
    if (state.groupId === g.id) return set({ groupId: null })
    const units = [personUnit(meId), ...g.memberIds.filter((m) => m !== meId).map(personUnit)]
    set({ groupId: g.id, units, values: {} })
  }

  const mutationError = save.error ? friendlyError(save.error) : null
  const formError = submitted && !split.ok ? t(split.error) : mutationError
  const applyPastedText = () => {
    setState((s) => applyPaste(s, pasteText, peopleList))
    setPasteOpen(false)
    const parsed = parsePaymentText(pasteText)
    if (!parsed.amount) toast(t('Couldn’t find an amount in that message'))
  }

  return (
    <Page
      title={existing ? t('Edit expense') : t('Add expense')}
      back
      footer={
        <div className="pb-1">
          {formError ? <p className="mb-2 text-center text-sm text-red-600 dark:text-red-400">{formError}</p> : null}
          <Button block busy={save.isPending} onClick={submit}>
            {split.ok
              ? myNet > 0
                ? t('Save · you get back {amount}', { amount: formatINR(myNet) })
                : myNet < 0
                  ? t('Save · your share {amount}', { amount: formatINR(-myNet) })
                  : t('Save')
              : t('Save')}
          </Button>
        </div>
      }
    >
      {/* Amount */}
      {byItem ? (
        <div className="mt-2 rounded-3xl bg-white py-6 text-center ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <p className="text-5xl font-bold tabular-nums">{amount ? formatINR(amount) : '₹0'}</p>
          <p className="mt-1 text-sm text-slate-500">{t('Total from {n} items', { n: state.items.filter((i) => i.amountText.trim()).length })}</p>
        </div>
      ) : (
      <label className="mt-2 flex items-center justify-center gap-1 rounded-3xl bg-white py-6 ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-brand-600 dark:bg-slate-900 dark:ring-slate-800">
        <span className="text-3xl font-semibold text-slate-400">₹</span>
        <input
          ref={amountRef}
          aria-label={t('Amount')}
          inputMode="decimal"
          placeholder="0"
          value={state.amountText}
          onChange={(e) => set({ amountText: e.target.value.replace(/[^\d.,]/g, '') })}
          style={{ width: `${Math.max(state.amountText.length, 1) + 0.5}ch` }}
          className="max-w-[70vw] bg-transparent text-5xl font-bold tabular-nums outline-none placeholder:text-slate-300 dark:placeholder:text-slate-700"
        />
      </label>
      )}

      {!existing ? (
        pasteOpen ? (
          <Card className="mt-3 space-y-2 p-3">
            <p className="text-sm font-medium">{t('Paste the payment message')}</p>
            <textarea
              aria-label={t('Payment message')}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={3}
              placeholder={t('e.g. “₹450 paid to Rahul Verma” from GPay, PhonePe, Paytm or your bank SMS')}
              className={`${inputClass} py-2`}
            />
            <div className="flex gap-2">
              <Button variant="secondary" className="min-h-10 flex-1 text-sm" onClick={() => setPasteOpen(false)}>{t('Cancel')}</Button>
              <Button className="min-h-10 flex-1 text-sm" disabled={!pasteText.trim()} onClick={applyPastedText}>{t('Use it')}</Button>
            </div>
          </Card>
        ) : (
          <div className="mt-2 flex justify-center gap-4">
            <button type="button" onClick={() => setPasteOpen(true)} className="min-h-9 text-sm font-medium text-brand-700 dark:text-brand-500">
              📋 {t('Paste UPI message')}
            </button>
            {!byItem ? (
              <button type="button" onClick={() => { setAdvanced(true); setMode('items') }} className="min-h-9 text-sm font-medium text-brand-700 dark:text-brand-500">
                🧾 {t('Split by item')}
              </button>
            ) : null}
          </div>
        )
      ) : !byItem ? (
        <button type="button" onClick={() => { setAdvanced(true); setMode('items') }} className="mt-2 min-h-9 w-full text-center text-sm font-medium text-brand-700 dark:text-brand-500">
          🧾 {t('Split by item')}
        </button>
      ) : null}

      {/* Description */}
      <div className="mt-4">
        <input
          aria-label={t('What was it for?')}
          placeholder={t('What was it for?')}
          value={state.description}
          maxLength={100}
          onChange={(e) => set({ description: e.target.value })}
          className={inputClass}
        />
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => set({ description: q })}
              className={`min-h-9 shrink-0 rounded-full px-3 text-sm ring-1 ${
                state.description === q ? 'bg-brand-50 text-brand-800 ring-brand-600 dark:bg-brand-800/30 dark:text-brand-100' : 'bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-700'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Who */}
      <SectionTitle
        action={
          <button type="button" onClick={() => setPicking(true)} className="flex min-h-9 items-center gap-1 text-sm font-semibold text-brand-700 dark:text-brand-500">
            <IconPlus size={16} /> {t('Add people')}
          </button>
        }
      >
        {group ? `${group.emoji ?? '👥'} ${group.name}` : t('Split between')}
      </SectionTitle>
      {iShare ? (
        <TurnHint
          meId={meId}
          groupId={state.groupId}
          units={state.units}
          balanceOf={balances.net}
          name={people.name}
          onPick={(id) => set({ payerMode: 'one', payerId: id })}
          payerId={state.payerMode === 'one' ? state.payerId : null}
        />
      ) : null}
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {state.units.length === 0 ? (
          <button type="button" onClick={() => setPicking(true)} className="w-full p-4 text-left text-slate-500">{t('Tap “Add people” to choose who shared this.')}</button>
        ) : null}
        {state.units.map((u) => {
          const owed = split.ok ? split.owedByUnit[u.key] : undefined
          return (
            <div key={u.key} className="flex min-h-14 items-center gap-3 px-3 py-2">
              {u.memberIds.length > 1 ? (
                <AvatarStack people={u.memberIds.map((m) => ({ id: m, name: people.name(m) }))} size={36} />
              ) : (
                <Avatar id={u.repId} name={people.name(u.repId, { you: false })} size={36} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{unitLabel(u)}</span>
                {u.memberIds.length > 1 ? <span className="block text-xs text-slate-500">{t('counted as one · {n} shares', { n: u.memberIds.length })}</span> : null}
              </span>
              {state.mode === 'equal' || byItem ? (
                <span className="text-sm font-semibold tabular-nums">{owed !== undefined ? formatINR(owed) : '—'}</span>
              ) : (
                <span className="flex items-center gap-2">
                  {state.mode === 'shares' && owed !== undefined ? <span className="text-xs text-slate-500 tabular-nums">{formatINR(owed)}</span> : null}
                  <input
                    aria-label={t(state.mode === 'exact' ? 'Amount for {name}' : 'Shares for {name}', { name: unitLabel(u) })}
                    inputMode="decimal"
                    value={state.values[u.key] ?? ''}
                    onChange={(e) => set({ values: { ...state.values, [u.key]: e.target.value } })}
                    placeholder={state.mode === 'exact' ? '₹0' : '1'}
                    className="h-10 w-20 rounded-lg bg-slate-100 px-2 text-right tabular-nums outline-none focus:ring-2 focus:ring-brand-600 dark:bg-slate-800"
                  />
                </span>
              )}
              <button type="button" aria-label={t('Remove {name}', { name: unitLabel(u) })} onClick={() => removeUnit(u.key)} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 active:bg-slate-100 dark:active:bg-slate-800">
                <IconX size={18} />
              </button>
            </div>
          )
        })}
      </Card>
      {state.units.length > 0 && !iShare ? (
        <div role="note" className="mt-3 rounded-2xl bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-100 dark:ring-sky-900">
          {iPay ? (
            <>
              <p>{t('You’re not sharing this, so they’ll owe you all of it.')}</p>
              <p className="mt-1">{t('Adding it for someone else? Choose who paid.')}</p>
              {!advanced ? (
                <button type="button" onClick={() => setAdvanced(true)} className="mt-2 min-h-9 font-semibold text-brand-700 dark:text-brand-400">
                  {t('Choose who paid')}
                </button>
              ) : null}
            </>
          ) : (
            <p>{t('You’re adding this for others — it won’t change your balance. They’ll see it to check, and you can still edit it.')}</p>
          )}
        </div>
      ) : null}
      {kittyHolder ? (
        <label className="mt-3 flex min-h-12 items-center gap-3 rounded-2xl bg-white px-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <input type="checkbox" checked={fromKitty} onChange={(e) => setFromKitty(e.target.checked)} className="h-5 w-5 accent-brand-700" />
          <span className="flex-1 text-sm font-medium">🏦 {kittyHolder === meId ? t('Paid from the kitty (you hold it)') : t('Paid from the kitty ({name} holds it)', { name: people.name(kittyHolder) })}</span>
        </label>
      ) : null}
      {advanced ? (
        <>
      <div className="mt-3">
          <Segmented
            label={t('How to split')}
            value={state.mode}
            onChange={setMode}
            options={[
              { value: 'equal', label: t('Equally') },
              { value: 'exact', label: t('Amounts') },
              { value: 'shares', label: t('Shares') },
              { value: 'items', label: t('By item') },
            ]}
          />
          {state.mode === 'exact' && amount ? <ExactRemaining amount={amount} units={state.units} values={state.values} /> : null}
        </div>
        {bill ? (
          <ItemsEditor
            units={state.units}
            unitLabel={unitLabel}
            items={state.items}
            onItems={(items) => set({ items })}
            extras={state.extras}
            onExtras={(extras) => set({ extras })}
            receiptText={state.amountText}
            onReceiptText={(amountText) => set({ amountText })}
            result={bill.result}
            subtotal={bill.subtotal}
          />
        ) : null}
  
        {/* Paid by */}
        <SectionTitle>{t('Paid by')}</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {payerCandidates.map((id) => {
            const active = state.payerMode === 'one' && state.payerId === id
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => set({ payerMode: 'one', payerId: id })}
                className={`flex min-h-10 items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-medium ring-1 ${
                  active ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-700'
                }`}
              >
                <Avatar id={id} name={people.name(id, { you: false })} size={28} />
                {people.name(id)}
              </button>
            )
          })}
          <button
            type="button"
            aria-pressed={state.payerMode === 'many'}
            onClick={() => set({ payerMode: 'many' })}
            className={`min-h-10 rounded-full px-3 text-sm font-medium ring-1 ${
              state.payerMode === 'many' ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-700'
            }`}
          >
            {t('Several people')}
          </button>
        </div>
        {state.payerMode === 'many' ? (
          <Card className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {payerCandidates.map((id) => (
              <div key={id} className="flex min-h-14 items-center gap-3 px-3">
                <Avatar id={id} name={people.name(id, { you: false })} size={32} />
                <span className="flex-1 font-medium">{people.name(id)}</span>
                <input
                  aria-label={t('Paid by {name}', { name: people.name(id) })}
                  inputMode="decimal"
                  placeholder="₹0"
                  value={state.payerAmounts[id] ?? ''}
                  onChange={(e) => set({ payerAmounts: { ...state.payerAmounts, [id]: e.target.value } })}
                  className="h-10 w-24 rounded-lg bg-slate-100 px-2 text-right tabular-nums outline-none focus:ring-2 focus:ring-brand-600 dark:bg-slate-800"
                />
              </div>
            ))}
          </Card>
        ) : null}
  
        </>
      ) : (
        <button
          type="button"
          onClick={() => setAdvanced(true)}
          className="mt-3 flex min-h-12 w-full items-center justify-between rounded-2xl bg-white px-4 text-left text-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
        >
          <span>
            {t('Split equally')} · {useKitty ? t('paid from kitty') : t('paid by {name}', { name: people.name(state.payerId) })}
          </span>
          <span className="font-semibold text-brand-700 dark:text-brand-500">{t('Change')}</span>
        </button>
      )}

      {/* Date */}
      <div className="mt-6">
        <Field label={t('Date')}>
          <input type="date" value={state.date} max={todayISO()} onChange={(e) => set({ date: e.target.value || todayISO() })} className={inputClass} />
        </Field>
      </div>
      {!existing ? (
        <label className="mt-4 flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={saveShortcut} onChange={(e) => setSaveShortcut(e.target.checked)} className="h-5 w-5 accent-brand-700" />
          <span className="text-sm">{t('Save as a shortcut on the home screen (for regular outings)')}</span>
        </label>
      ) : null}

      <ParticipantSheet
        open={picking}
        onClose={() => setPicking(false)}
        meId={meId}
        units={state.units}
        groupId={state.groupId}
        groups={groups}
        canChangeGroup={!existing}
        households={households}
        onToggle={toggleUnit}
        onGroup={chooseGroup}
      />
    </Page>
  )
}

function ExactRemaining({ amount, units, values }: { amount: Paise; units: SplitUnit[]; values: Record<string, string> }) {
  const assigned = units.reduce((s, u) => s + (parseRupees(values[u.key] ?? '') ?? 0), 0)
  const left = amount - assigned
  const { t } = useT()
  if (left === 0) return <p className="mt-2 text-sm text-owed">✓ {t('Adds up to {amount}', { amount: formatINR(amount) })}</p>
  return (
    <p className="mt-2 text-sm text-owe">
      {left > 0 ? t('{amount} left to assign', { amount: formatINR(left) }) : t('{amount} too much', { amount: formatINR(-left) })}
    </p>
  )
}

/**
 * Nudges toward "take turns": in a group, whoever is furthest behind there;
 * otherwise based on my own balances with the people on this bill.
 */
function TurnHint({
  meId,
  groupId,
  units,
  balanceOf,
  name,
  onPick,
  payerId,
}: {
  meId: string
  groupId: string | null
  units: SplitUnit[]
  balanceOf: (id: string) => Paise
  name: (id: string) => string
  onPick: (id: string) => void
  payerId: string | null
}) {
  const groupBalances = useQuery({
    queryKey: keys.groupBalances(groupId ?? ''),
    queryFn: () => api.groupBalances(groupId!),
    enabled: Boolean(groupId),
  })
  const { t } = useT()
  const others = units.flatMap((u) => u.memberIds).filter((id) => id !== meId)
  if (others.length === 0) return null

  let suggestion: { personId: string; text: string } | null = null
  if (groupId && groupBalances.data) {
    const involved = new Set([meId, ...others])
    const nets = Object.fromEntries(groupBalances.data.filter((b) => involved.has(b.person_id)).map((b) => [b.person_id, b.net]))
    const turn = whoPaysNext(nets)
    if (turn) {
      suggestion = {
        personId: turn.personId,
        text:
          turn.personId === meId
            ? t('You’re behind by {amount} in this group — your baari?', { amount: formatINR(turn.behindBy) })
            : t('{name} is behind by {amount} in this group — their baari?', { name: name(turn.personId), amount: formatINR(turn.behindBy) }),
      }
    }
  } else if (!groupId) {
    const total = others.reduce((s, id) => s + balanceOf(id), 0)
    const topDebtor = [...others].sort((a, b) => balanceOf(b) - balanceOf(a))[0]
    if (total < 0) {
      const who = others.length === 1 ? name(others[0]) : t('these friends')
      suggestion = { personId: meId, text: t('You owe {who} {amount} — your baari. This bill evens things out.', { who, amount: formatINR(-total) }) }
    } else if (balanceOf(topDebtor) > 0) {
      suggestion = { personId: topDebtor, text: t('{name} owes you {amount} — their baari?', { name: name(topDebtor), amount: formatINR(balanceOf(topDebtor)) }) }
    }
  }
  if (!suggestion) return null
  const chosen = payerId === suggestion.personId
  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-900">
      <span aria-hidden className="text-lg">⚖️</span>
      <span className="flex-1">{suggestion.text}</span>
      {chosen ? (
        <span className="text-xs font-semibold">✓ {t('Set')}</span>
      ) : (
        <button type="button" onClick={() => onPick(suggestion.personId)} className="min-h-9 shrink-0 rounded-full bg-amber-200/70 px-3 font-semibold dark:bg-amber-800/60">
          {suggestion.personId === meId ? t('I’ll pay') : t('{name} pays', { name: name(suggestion.personId) })}
        </button>
      )}
    </div>
  )
}

function ParticipantSheet({
  open,
  onClose,
  meId,
  units,
  groupId,
  groups,
  households,
  onToggle,
  onGroup,
  canChangeGroup,
}: {
  canChangeGroup: boolean
  open: boolean
  onClose: () => void
  meId: string
  units: SplitUnit[]
  groupId: string | null
  groups: Group[]
  households: Household[]
  onToggle: (u: SplitUnit) => void
  onGroup: (g: Group) => void
}) {
  const people = usePeople()
  const { t } = useT()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const group = groups.find((g) => g.id === groupId)
  const selected = new Set(units.map((u) => u.key))
  const allowed = (id: string) => !group || group.memberIds.includes(id)

  const friends = people.list
    .filter((p) => (p.is_contact || p.is_me) && allowed(p.id))
    .filter((p) => !q || p.display_name.toLowerCase().includes(q) || (p.phone ?? '').includes(q))
    .sort((a, b) => Number(b.is_me) - Number(a.is_me) || a.display_name.localeCompare(b.display_name))
  const pairs = households
    .map((h) => ({ h, unit: householdUnit(h, meId) }))
    .filter(({ unit }) => unit.memberIds.length > 0 && unit.memberIds.every(allowed))
    .filter(({ h }) => !q || h.name.toLowerCase().includes(q))
  const groupMatches = canChangeGroup ? groups.filter((g) => !q || g.name.toLowerCase().includes(q)) : []

  return (
    <Sheet open={open} onClose={onClose} title={t('Who shared this?')}>
      <div className="space-y-4">
        <SearchBox value={query} onChange={setQuery} />
        {groupMatches.length > 0 ? (
          <section>
            <h3 className="mb-1 text-xs font-semibold text-slate-500 uppercase">{t('Groups')}</h3>
            {groupMatches.map((g) => (
              <CheckRow
                key={g.id}
                checked={groupId === g.id}
                onClick={() => onGroup(g)}
                id={g.id}
                name={g.name}
                subtitle={t('{n} people', { n: g.memberIds.length })}
                leading={<span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg dark:bg-slate-800">{g.emoji ?? '👥'}</span>}
              />
            ))}
          </section>
        ) : null}
        {pairs.length > 0 ? (
          <section>
            <h3 className="mb-1 text-xs font-semibold text-slate-500 uppercase">{t('Pairs · counted as one')}</h3>
            {pairs.map(({ h, unit }) => (
              <CheckRow
                key={h.id}
                checked={selected.has(unit.key)}
                onClick={() => onToggle(unit)}
                id={h.id}
                name={h.name}
                subtitle={unit.memberIds.map((m) => people.name(m)).join(' · ')}
                leading={<AvatarStack people={unit.memberIds.map((m) => ({ id: m, name: people.name(m) }))} size={36} />}
              />
            ))}
          </section>
        ) : null}
        <section>
          <h3 className="mb-1 text-xs font-semibold text-slate-500 uppercase">{group ? t('People in {name}', { name: group.name }) : t('Friends')}</h3>
          {friends.map((p) => (
            <CheckRow
              key={p.id}
              checked={selected.has(p.id)}
              onClick={() => onToggle(personUnit(p.id))}
              id={p.id}
              name={p.is_me ? t('You') : p.display_name}
            />
          ))}
        </section>
        {group ? null : <InlineAddFriend onAdded={(id) => onToggle(personUnit(id))} initialName={friends.length === 0 ? query : ''} />}
        <Button block onClick={onClose}>{t('Done')}</Button>
      </div>
    </Sheet>
  )
}
