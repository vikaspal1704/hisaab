import { supabase } from './supabase'

/** SHA-256 of "hisaab:" + an E.164 number, as hex. Must match people.phone_hash in the database. */
export async function hashPhone(e164: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`hisaab:${e164}`))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Which of these numbers belong to people already on Hisaab. Only hashes are
 * sent. Returns an empty set if matching isn't available (e.g. the database
 * hasn't been updated yet) — it's a nice-to-have, never a blocker.
 */
export async function findRegistered(phones: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  if (phones.length === 0 || !crypto?.subtle) return found
  try {
    const byHash = new Map<string, string>()
    for (const phone of phones) byHash.set(await hashPhone(phone), phone)
    const hashes = [...byHash.keys()]
    for (let i = 0; i < hashes.length; i += 2000) {
      const { data, error } = await supabase.rpc('match_contacts', { p_hashes: hashes.slice(i, i + 2000) })
      if (error) break
      for (const h of (data ?? []) as string[]) {
        const phone = byHash.get(h)
        if (phone) found.add(phone)
      }
    }
  } catch {
    // Matching is best-effort.
  }
  return found
}
