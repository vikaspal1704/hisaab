import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from './Toast'
import { Button, Card, SectionTitle } from './ui'
import { keys, useLedgerMutation, usePeople } from '../hooks/queries'
import { api } from '../lib/api'
import { nextDriver, tripDefaults, tripTotal, type CarpoolTrip, type Direction, type SeatCount } from '../lib/carpool'
import { friendlyError } from '../lib/errors'
import { formatDay, todayISO } from '../lib/format'
import { useT } from '../lib/i18n'
import { formatINR, parseRupees, toRupeeInput } from '../lib/money'
import type { Group } from '../lib/types'

const DIRECTIONS: { value: Direction; label: string; icon: string }[] = [
  { value: 'am', label: 'Morning', icon: '☀️' },
  { value: 'pm', label: 'Evening', icon: '🌙' },
]

const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return todayISO(d)
}

/** Log today's rides (both ways) and keep turns fair. */
export function CarpoolCard({ group }: { group: Group }) {
  const { t } = useT()
  const people = usePeople()
  const [date, setDate] = useState(todayISO())
  const trips = useQuery({ queryKey: keys.carpoolTrips(group.id), queryFn: () => api.carpoolTrips(group.id, daysAgo(45)) })
  const summary = useQuery({ queryKey: keys.carpoolSummary(group.id), queryFn: () => api.carpoolSummary(group.id) })
  const style = group.carpoolStyle

  if (!style) {
    return (
      <Card className="mt-4 p-4 text-sm">
        <p className="font-semibold">🚗 {t('Set up this car pool')}</p>
        <p className="mt-1 text-slate-600 dark:text-slate-300">{t('Choose how you share costs: a fare to the driver, split the fuel, or just take turns.')}</p>
        <Link to={`/g/${group.id}/edit`} className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-brand-700 font-semibold text-white">
          {t('Choose')}
        </Link>
      </Card>
    )
  }

  const recent = trips.data ?? []
  const counts = summary.data ?? []
  const suggested = nextDriver(group.memberIds, counts, style, recent[0]?.driver_id ?? null)
  const styleLabel = { fare: t('fare {amount} per rider', { amount: formatINR(group.carpoolAmount ?? 0) }), split: t('split the cost'), turns: t('take turns') }[style]

  return (
    <>
      <Card className="mt-4 space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold">🚗 {t('Rides')}</p>
            <p className="text-xs text-slate-500">{styleLabel}</p>
          </div>
          <input
            type="date"
            aria-label={t('Date')}
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value || todayISO())}
            className="h-9 rounded-lg bg-slate-100 px-2 text-sm dark:bg-slate-800"
          />
        </div>
        {style !== 'fare' && counts.some((c) => c.drives + c.rides > 0) ? (
          <p className="rounded-xl bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            ⚖️ {suggested === people.me?.id ? t('Your turn to drive next') : t('{name}’s turn to drive next', { name: people.name(suggested) })}
          </p>
        ) : null}
        {trips.isPending || summary.isPending ? null : (
          DIRECTIONS.map((d) => {
            const logged = recent.find((x) => x.trip_date === date && x.direction === d.value)
            return logged ? (
              <LoggedTrip key={d.value} trip={logged} label={`${d.icon} ${t(d.label)}`} group={group} />
            ) : (
              <TripForm
                // Remount when the day or the history changes so the defaults follow.
                key={`${d.value}|${date}|${recent.length}`}
                group={group}
                direction={d.value}
                label={`${d.icon} ${t(d.label)}`}
                date={date}
                recent={recent}
                counts={counts}
              />
            )
          })
        )}
      </Card>
      <SeatTally group={group} counts={counts} />
    </>
  )
}

function LoggedTrip({ trip, label, group }: { trip: CarpoolTrip; label: string; group: Group }) {
  const { t } = useT()
  const toast = useToast()
  const people = usePeople()
  const undo = useLedgerMutation(() => api.deleteCarpoolTrip(trip.id))
  const me = people.me?.id
  const inCar = me === trip.driver_id || (me ? trip.riders.includes(me) : false)
  const total = tripTotal(group.carpoolStyle ?? 'turns', trip.amount, trip.riders.length)
  return (
    <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
      <span className="flex-1">
        <span className="block font-medium">
          {label} · ✓ {t('{name} drove', { name: people.name(trip.driver_id) })}
        </span>
        <span className="block text-slate-500 dark:text-slate-400">
          {trip.riders.map((r) => people.name(r)).join(', ')}
          {total ? ` · ${formatINR(total)}` : ''}
        </span>
      </span>
      {inCar ? (
        <button
          type="button"
          disabled={undo.isPending}
          onClick={() => undo.mutate(undefined, { onSuccess: () => toast(t('Ride removed')) })}
          className="min-h-9 shrink-0 text-sm font-semibold text-red-600"
        >
          {t('Undo')}
        </button>
      ) : null}
    </div>
  )
}

function TripForm({
  group,
  direction,
  label,
  date,
  recent,
  counts,
}: {
  group: Group
  direction: Direction
  label: string
  date: string
  recent: CarpoolTrip[]
  counts: SeatCount[]
}) {
  const { t } = useT()
  const toast = useToast()
  const people = usePeople()
  const style = group.carpoolStyle!
  const defaults = tripDefaults({ date, direction, recent, members: group.memberIds, counts, style })
  const [driver, setDriver] = useState(defaults.driver)
  const [riders, setRiders] = useState<string[]>(defaults.riders)
  const [amountText, setAmountText] = useState(group.carpoolAmount ? toRupeeInput(group.carpoolAmount) : '')
  const amount = style === 'turns' ? null : parseRupees(amountText)
  const me = people.me?.id ?? ''
  const inCar = driver === me || riders.includes(me)
  const ridersInCar = riders.filter((r) => r !== driver)
  const total = tripTotal(style, amount, ridersInCar.length)

  const save = useLedgerMutation(() => api.saveCarpoolTrip({ groupId: group.id, date, direction, driver, riders: ridersInCar, amount }))
  const toggle = (id: string) => setRiders((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
  const problem =
    ridersInCar.length === 0
      ? t('Tap who rode')
      : !inCar
        ? t('Only someone in the car can log it')
        : style !== 'turns' && !amount
          ? t(style === 'fare' ? 'Enter the fare per rider' : 'Enter the trip cost')
          : null

  const chip = (on: boolean) =>
    `min-h-9 rounded-full px-3 text-sm font-medium ring-1 ${on ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700'}`

  return (
    <div className="space-y-2 rounded-xl ring-1 ring-slate-200 p-3 dark:ring-slate-700">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-semibold">{label}</span>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-slate-500">{t('Driver')}</span>
          <select
            aria-label={t('{label} driver', { label })}
            value={driver}
            onChange={(e) => {
              setRiders((list) => (list.includes(e.target.value) ? [...list.filter((x) => x !== e.target.value), driver] : list))
              setDriver(e.target.value)
            }}
            className="h-9 rounded-lg bg-slate-100 px-2 font-medium dark:bg-slate-800"
          >
            {group.memberIds.map((id) => (
              <option key={id} value={id}>{people.name(id)}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('{label} riders', { label })}>
        {group.memberIds
          .filter((id) => id !== driver)
          .map((id) => (
            <button key={id} type="button" aria-pressed={riders.includes(id)} className={chip(riders.includes(id))} onClick={() => toggle(id)}>
              {people.name(id)}
            </button>
          ))}
      </div>
      <div className="flex items-center gap-2">
        {style !== 'turns' ? (
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            {style === 'fare' ? t('Fare ₹') : t('Cost ₹')}
            <input
              inputMode="decimal"
              aria-label={t(style === 'fare' ? '{label} fare per rider' : '{label} trip cost', { label })}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value.replace(/[^\d.,]/g, ''))}
              className="h-9 w-20 rounded-lg bg-slate-100 px-2 text-right text-slate-900 tabular-nums dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
        ) : null}
        <Button
          className="min-h-10 flex-1 text-sm"
          disabled={Boolean(problem)}
          busy={save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => toast(t('Ride logged for {date}', { date: formatDay(date) })) })}
        >
          {problem ?? (total ? t('Log ride · {amount}', { amount: formatINR(total) }) : t('Log ride'))}
        </Button>
      </div>
      {save.error ? <p className="text-sm text-red-600">{friendlyError(save.error)}</p> : null}
    </div>
  )
}

/** Drives vs rides per person: the fairness count behind "whose turn". */
function SeatTally({ group, counts }: { group: Group; counts: SeatCount[] }) {
  const { t } = useT()
  const people = usePeople()
  if (!counts.some((c) => c.drives + c.rides > 0)) return null
  const rows = [...counts].sort((a, b) => a.seats - b.seats)
  return (
    <>
      <SectionTitle>{t('Who drove, who rode')}</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((c) => (
          <div key={c.person_id} className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm">
            <span className="flex-1 font-medium">{people.name(c.person_id)}</span>
            <span className="text-slate-500">{t('drove {d} · rode {r}', { d: c.drives, r: c.rides })}</span>
            <span className={`w-20 text-right font-semibold tabular-nums ${c.seats < 0 ? 'text-owe' : c.seats > 0 ? 'text-owed' : 'text-slate-400'}`}>
              {c.seats === 0 ? '—' : `${c.seats > 0 ? '+' : '−'}${Math.abs(c.seats)} ${Math.abs(c.seats) === 1 ? t('seat') : t('seats')}`}
            </span>
          </div>
        ))}
      </Card>
      {group.carpoolStyle === 'turns' ? null : (
        <p className="mt-1 px-1 text-xs text-slate-500">{t('Money for rides is in “Balances in this group” below.')}</p>
      )}
    </>
  )
}
