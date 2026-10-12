const KEY = 'hisaab.sharedText'

/**
 * The installed app is registered as a share target (manifest share_target),
 * so Android opens "./?share_text=..." when someone shares a UPI receipt to
 * Hisaab. We stash the text before login can redirect and drop it from the URL.
 */
export function captureSharedText(): void {
  const params = new URLSearchParams(window.location.search)
  const text = [params.get('share_title'), params.get('share_text'), params.get('share_url')].filter(Boolean).join('\n')
  if (!text) return
  try {
    sessionStorage.setItem(KEY, text.slice(0, 2000))
  } catch {
    // Storage blocked: the shared text is simply ignored.
  }
  params.delete('share_title')
  params.delete('share_text')
  params.delete('share_url')
  const query = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash)
}

export function takeSharedText(): string | null {
  try {
    const text = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return text
  } catch {
    return null
  }
}
