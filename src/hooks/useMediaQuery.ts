import { useSyncExternalStore } from 'react'

const DESKTOP = '(min-width: 64rem)' // Tailwind's lg

function subscribe(query: string) {
  return (onChange: () => void) => {
    const list = window.matchMedia(query)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }
}

/** True on laptop-sized screens, where pages switch to their multi-column layout. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe(DESKTOP), () => window.matchMedia(DESKTOP).matches, () => false)
}
