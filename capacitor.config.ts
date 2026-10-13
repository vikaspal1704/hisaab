import type { CapacitorConfig } from '@capacitor/cli'

// The Android app wraps the same web build (dist/). See README → "Android app".
const config: CapacitorConfig = {
  appId: 'app.hisaab',
  appName: 'Hisaab',
  webDir: 'dist',
  android: {
    // Lets Google sign-in hand control back to the app (see src/lib/native.ts).
    allowMixedContent: false,
  },
  plugins: {
    SystemBars: {
      // The app already pads for the status/navigation bars with env(safe-area-inset-*).
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
    },
  },
}

export default config
