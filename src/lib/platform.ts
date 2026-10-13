export type Platform = 'iphone' | 'android' | 'other'

/** Which phone this is, to show the right "how to export contacts" steps. */
export function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iphone'
  if (/Android/.test(ua)) return 'android'
  return 'other'
}

interface ContactsManager {
  select(props: string[], options: { multiple: boolean }): Promise<{ name?: string[]; tel?: string[] }[]>
}

/** The phone's contact picker (Android Chrome); undefined where it isn't available. */
export const contactPicker = (navigator as Navigator & { contacts?: ContactsManager }).contacts
