import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { supabase } from './supabase'

/** True inside the Android app (Capacitor), false in a browser. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

/** Where Google sends you back after signing in from the app (see AndroidManifest.xml). */
export const NATIVE_AUTH_CALLBACK = 'app.hisaab://auth-callback'

/**
 * Google won't sign in inside an app's web view, so the app opens the sign-in
 * page in the phone's browser and Google returns to app.hisaab://auth-callback
 * with a one-time code, which is swapped for a session here.
 */
export async function nativeGoogleSignIn(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: NATIVE_AUTH_CALLBACK, skipBrowserRedirect: true },
  })
  if (error) throw error
  if (data.url) await Browser.open({ url: data.url, presentationStyle: 'popover' })
}

/** One-time setup when running as the Android app. */
export function initNativeApp(): void {
  if (!isNativeApp()) return

  void App.addListener('appUrlOpen', async ({ url }) => {
    if (!url.startsWith(NATIVE_AUTH_CALLBACK)) return
    const code = new URL(url).searchParams.get('code')
    void Browser.close().catch(() => {})
    if (code) await supabase.auth.exchangeCodeForSession(code)
  })

  // Android's back button walks back through the app instead of closing it.
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back()
    else void App.minimizeApp()
  })

  // Links to WhatsApp, UPI apps and websites open in those apps, not inside Hisaab.
  document.addEventListener(
    'click',
    (event) => {
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link || link.hasAttribute('download')) return
      const href = link.href
      const external = !href.startsWith(window.location.origin) && !href.startsWith('#')
      if (!external) return
      event.preventDefault()
      // The app's web view hands non-app URLs to Android, which picks WhatsApp, a UPI app or the browser.
      window.location.href = href
    },
    true,
  )
}

/** Saves a file to the app cache and opens the share sheet (WhatsApp, Drive, Files…). */
export async function shareFile(name: string, data: string, encoding: 'utf8' | 'base64', title: string): Promise<void> {
  const { uri } = await Filesystem.writeFile({
    path: name,
    data,
    directory: Directory.Cache,
    ...(encoding === 'utf8' ? { encoding: Encoding.UTF8 } : {}),
  })
  await Share.share({ title, files: [uri] })
}
