import { Card } from '../components/ui'

export function SetupNeededPage() {
  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="mt-10 text-2xl font-bold">Almost there</h1>
      <Card className="mt-4 p-4 text-sm leading-relaxed">
        <p>This build of Hisaab isn’t connected to a database yet.</p>
        <p className="mt-2">
          Set <code className="font-mono">VITE_SUPABASE_URL</code> and <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>{' '}
          (see the README’s “Deploy for free” section) and rebuild.
        </p>
      </Card>
    </div>
  )
}
