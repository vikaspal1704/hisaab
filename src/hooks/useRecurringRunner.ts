import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../lib/api'

/**
 * Posts any monthly expenses (rent, WiFi…) that have come due. Runs once
 * when the app opens; the database makes sure each month is posted once
 * even if several flatmates open the app at the same time.
 */
export function useRecurringRunner(enabled: boolean) {
  const client = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    api
      .runDueRecurring()
      .then((posted) => {
        if (posted > 0) void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
      })
      .catch(() => {
        // Not critical: the next app open tries again.
      })
  }, [enabled, client])
}
