import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Refreshes data when a friend adds or changes an entry involving me
 * (Supabase Realtime applies RLS, so only my entries arrive), and when the
 * app comes back to the foreground.
 */
export function useLiveUpdates(enabled: boolean) {
  const client = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' }), 300)
    }
    const channel = supabase
      .channel('ledger-events')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entry_events' }, refresh)
      .subscribe()
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [client, enabled])
}
