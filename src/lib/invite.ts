const KEY = 'hisaab.invite'

/**
 * A passbook link a friend sent doubles as an invite: opening it and then
 * signing up hands over the history they recorded against your number (see
 * claim_profile). Kept in localStorage so it survives the Google sign-in
 * redirect.
 */
export function rememberInvite(token: string): void {
  try {
    localStorage.setItem(KEY, token)
  } catch {
    // Storage blocked: joining still works, just without the invite.
  }
}

export function pendingInvite(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function clearInvite(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to clear
  }
}
