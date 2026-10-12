import { api } from './api'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/** Push needs a service worker, the Push API, and a configured VAPID key. iPhone: only once installed to the home screen. */
export function pushAvailable(): boolean {
  return Boolean(VAPID_PUBLIC_KEY) && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function registration() {
  return navigator.serviceWorker.ready
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushAvailable()) return null
  return (await registration()).pushManager.getSubscription()
}

/** Asks permission and registers this device. Returns false if the person said no. */
export async function enablePush(): Promise<boolean> {
  if (!pushAvailable()) return false
  if ((await Notification.requestPermission()) !== 'granted') return false
  const reg = await registration()
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY!) }))
  const json = sub.toJSON()
  await api.savePushSubscription(sub.endpoint, json.keys?.p256dh ?? '', json.keys?.auth ?? '')
  return true
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await api.deletePushSubscription(sub.endpoint)
  await sub.unsubscribe()
}
