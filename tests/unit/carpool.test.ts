import { describe, expect, it } from 'vitest'
import { nextDriver, tripDefaults, tripTotal, type CarpoolTrip, type SeatCount } from '../../src/lib/carpool'

const members = ['a', 'b', 'c']
const count = (person_id: string, drives: number, rides: number, seats: number): SeatCount => ({ person_id, drives, rides, seats })
const trip = (direction: 'am' | 'pm', driver_id: string, riders: string[]): CarpoolTrip => ({
  id: `${direction}${driver_id}`,
  trip_date: '2026-10-12',
  direction,
  driver_id,
  riders,
  amount: null,
  entry_id: null,
})

describe('nextDriver', () => {
  it('picks whoever has given the fewest seats for their rides', () => {
    expect(nextDriver(members, [count('a', 3, 1, 5), count('b', 1, 3, -1), count('c', 1, 2, 0)], 'turns', 'a')).toBe('b')
  })
  it('breaks ties by fewest drives, then not the last driver, then order', () => {
    expect(nextDriver(members, [count('a', 1, 2, 0), count('b', 0, 0, 0), count('c', 1, 2, 0)], 'split', null)).toBe('b')
    expect(nextDriver(members, [], 'turns', 'a')).toBe('b')
    expect(nextDriver(members, [], 'turns', null)).toBe('a')
  })
  it('keeps the same driver when riders pay a fare', () => {
    expect(nextDriver(members, [count('a', 9, 0, 20)], 'fare', 'c')).toBe('c')
    expect(nextDriver(members, [], 'fare', null)).toBe('a')
  })
})

describe('tripDefaults', () => {
  it('reuses the last crew for that direction with the suggested driver', () => {
    const recent = [trip('pm', 'a', ['b']), trip('am', 'a', ['b', 'c'])]
    expect(tripDefaults({ date: '2026-10-13', direction: 'am', recent, members, counts: [count('a', 2, 0, 3), count('b', 0, 2, -2), count('c', 0, 1, -1)], style: 'turns' })).toEqual({
      driver: 'b',
      riders: ['a', 'c'],
    })
    expect(tripDefaults({ date: '2026-10-13', direction: 'pm', recent, members, counts: [], style: 'fare' })).toEqual({ driver: 'a', riders: ['b'] })
  })
  it('takes the same car back when the other leg of the day is logged', () => {
    const recent = [trip('am', 'c', ['a']), trip('pm', 'a', ['b', 'c'])]
    expect(tripDefaults({ date: '2026-10-12', direction: 'pm', recent: [recent[0]], members, counts: [], style: 'turns' })).toEqual({ driver: 'c', riders: ['a'] })
  })
  it('puts everyone in the car when there is no history', () => {
    expect(tripDefaults({ date: '2026-10-13', direction: 'am', recent: [], members, counts: [], style: 'split' })).toEqual({ driver: 'a', riders: ['b', 'c'] })
  })
})

describe('tripTotal', () => {
  it('is fare × riders, the trip cost, or nothing', () => {
    expect(tripTotal('fare', 8000, 3)).toBe(24000)
    expect(tripTotal('split', 30000, 3)).toBe(30000)
    expect(tripTotal('turns', null, 3)).toBe(0)
  })
})
