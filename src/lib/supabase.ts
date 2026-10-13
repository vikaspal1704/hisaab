import { Capacitor } from '@capacitor/core'
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && key)

export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: {
    // PKCE returns ?code=... instead of #access_token=..., which keeps the
    // hash free for the router.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    // In the Android app the code arrives through a deep link instead (see native.ts).
    detectSessionInUrl: !Capacitor.isNativePlatform(),
  },
})

export const phoneOtpEnabled = import.meta.env.VITE_ENABLE_PHONE_OTP === 'true'
