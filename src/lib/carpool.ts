import type { Paise } from './money'

export type CarpoolStyle = 'fare' | 'split' | 'turns'
export type Direction = 'am' | 'pm'

export interface CarpoolTrip {
  id: string
  trip_date: string
  direction: Direction
  driver_id: string
  riders: string[]
  /** fare per rider (fare) or the trip's cost (split); null for turns */
  amount: Paise | null
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
  if (style === 'fare') return lastDriver && members.includes(lastDriver) ? lastDriver : members[0]
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

/** What a trip costs in total: fare × riders, the trip cost, or nothing for turns. */
export function tripTotal(style: CarpoolStyle, amount: Paise | null, riders: number): Paise {
  if (style === 'turns' || !amount) return 0
  return style === 'fare' ? amount * riders : amount
}
