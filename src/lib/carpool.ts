import type { Paise } from './money'

export type CarpoolStyle = 'fare' | 'split' | 'turns' | 'distance'
export type Direction = 'am' | 'pm'

export interface CarpoolTrip {
  id: string
  trip_date: string
  direction: Direction
  driver_id: string
  riders: string[]
  /** fare per rider (fare), the trip's cost (split) or the rate per km (distance); null for turns */
  amount: Paise | null
  /** what the trip cost in total, when the database recorded it (distance trips) */
  total?: Paise | null
  entry_id: string | null
}

export interface SeatCount {
  person_id: string
  drives: number
  rides: number
  /** seats given as driver minus rides taken; below zero = rode more than drove */
  seats: number
}

/**
 * Who should drive next. With a fare there's usually one car owner, so it's
 * whoever drove last. Otherwise it's whoever has given the fewest seats for
 * the rides they've taken (fewest drives breaks ties, then not the last driver).
 */
export function nextDriver(members: string[], counts: SeatCount[], style: CarpoolStyle, lastDriver: string | null): string {
  // One car owner usually drives when riders pay them: keep the last driver.
  if (style === 'fare' || style === 'distance') return lastDriver && members.includes(lastDriver) ? lastDriver : members[0]
  const by = new Map(counts.map((c) => [c.person_id, c]))
  return [...members].sort((a, b) => {
    const ca = by.get(a)
    const cb = by.get(b)
    return (
      (ca?.seats ?? 0) - (cb?.seats ?? 0) ||
      (ca?.drives ?? 0) - (cb?.drives ?? 0) ||
      Number(a === lastDriver) - Number(b === lastDriver) ||
      members.indexOf(a) - members.indexOf(b)
    )
  })[0]
}

/**
 * Starting point for logging a trip. If the other leg of the same day is
 * already logged, it's the same car back (same driver and people). Otherwise
 * the same people as the last trip in this direction, with the suggested
 * driver. With no history, everyone rides with the suggested driver.
 */
export function tripDefaults(args: {
  date: string
  direction: Direction
  recent: CarpoolTrip[]
  members: string[]
  counts: SeatCount[]
  style: CarpoolStyle
}): { driver: string; riders: string[] } {
  const { date, direction, recent, members, counts, style } = args
  const sameDay = recent.find((t) => t.trip_date === date && t.direction !== direction)
  if (sameDay && members.includes(sameDay.driver_id)) {
    return { driver: sameDay.driver_id, riders: sameDay.riders.filter((id) => members.includes(id)) }
  }
  const last = recent.find((t) => t.direction === direction)
  const driver = nextDriver(members, counts, style, last?.driver_id ?? recent[0]?.driver_id ?? null)
  const crew = last ? [last.driver_id, ...last.riders] : members
  return { driver, riders: crew.filter((id) => id !== driver && members.includes(id)) }
}

/** How far each member rides, one way, by person id. */
export type Distances = ReadonlyMap<string, number>

/**
 * What each rider owes the driver on a by-distance trip: their km × the rate
 * per km, to the paisa (same rounding as the database). Riders without a
 * distance are listed in `missing`.
 */
export function distanceCharges(riders: string[], km: Distances, ratePerKm: Paise): { charges: Map<string, Paise>; missing: string[] } {
  const charges = new Map<string, Paise>()
  const missing: string[] = []
  for (const id of riders) {
    const d = km.get(id)
    if (d === undefined) missing.push(id)
    else charges.set(id, Math.round(d * ratePerKm))
  }
  return { charges, missing }
}

/** What a trip costs in total: fare × riders, the trip cost, km × rate per rider, or nothing for turns. */
export function tripTotal(style: CarpoolStyle, amount: Paise | null, riders: string[], km: Distances = new Map()): Paise {
  if (style === 'turns' || !amount) return 0
  if (style === 'distance') return [...distanceCharges(riders, km, amount).charges.values()].reduce((a, b) => a + b, 0)
  return style === 'fare' ? amount * riders.length : amount
}
