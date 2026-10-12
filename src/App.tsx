import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { BottomNav } from './components/BottomNav'
import { ErrorView, LoadingView } from './components/ui'
import { useMyPersonId } from './hooks/queries'
import { useLiveUpdates } from './hooks/useLiveUpdates'
import { friendlyError } from './lib/errors'
import { isConfigured } from './lib/supabase'
import { ActivityPage } from './pages/Activity'
import { AddFriendPage } from './pages/AddFriend'
import { EntryPage } from './pages/Entry'
import { ExpenseFormPage } from './pages/ExpenseForm'
import { FriendPage } from './pages/Friend'
import { GroupPage } from './pages/Group'
import { GroupFormPage } from './pages/GroupForm'
import { GroupsPage } from './pages/Groups'
import { HomePage } from './pages/Home'
import { HouseholdFormPage } from './pages/HouseholdForm'
import { HouseholdPage } from './pages/Household'
import { ImportContactsPage } from './pages/ImportContacts'
import { LoginPage } from './pages/Login'
import { OnboardingPage } from './pages/Onboarding'
import { ProfilePage } from './pages/Profile'
import { SettleUpPage } from './pages/SettleUp'
import { SetupNeededPage } from './pages/SetupNeeded'
import { SharedPage } from './pages/Shared'
import { TreatPage } from './pages/Treat'
import { useRecurringRunner } from './hooks/useRecurringRunner'
import { takeSharedText } from './lib/shareTarget'

const NAV_ROUTES = ['/', '/groups', '/activity', '/me']

export function App() {
  const { session, loading } = useAuth()
  const me = useMyPersonId(Boolean(session))
  const location = useLocation()
  const navigate = useNavigate()
  const signedIn = Boolean(session && me.data)
  useLiveUpdates(signedIn)
  useRecurringRunner(signedIn)

  // Text shared into the app (e.g. a UPI payment confirmation) opens Add expense.
  useEffect(() => {
    if (!signedIn) return
    const text = takeSharedText()
    if (text) navigate(`/add?paste=${encodeURIComponent(text)}`)
  }, [signedIn, navigate])

  if (!isConfigured) return <SetupNeededPage />
  // Share links work without an account.
  if (location.pathname.startsWith('/s/')) {
    return (
      <Routes>
        <Route path="/s/:token" element={<SharedPage />} />
      </Routes>
    )
  }
  if (loading) return <LoadingView />
  if (!session) return <LoginPage />
  if (me.isPending) return <LoadingView />
  if (me.isError) return <ErrorView message={friendlyError(me.error)} onRetry={() => me.refetch()} />
  if (!me.data) return <OnboardingPage />

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/groups/new" element={<GroupFormPage />} />
        <Route path="/g/:id" element={<GroupPage />} />
        <Route path="/g/:id/edit" element={<GroupFormPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/me" element={<ProfilePage />} />
        <Route path="/friends/new" element={<AddFriendPage />} />
        <Route path="/friends/import" element={<ImportContactsPage />} />
        <Route path="/p/:id" element={<FriendPage />} />
        <Route path="/h/:id" element={<HouseholdPage />} />
        <Route path="/pairs/new" element={<HouseholdFormPage />} />
        <Route path="/pairs/:id/edit" element={<HouseholdFormPage />} />
        <Route path="/add" element={<ExpenseFormPage />} />
        <Route path="/e/:id" element={<EntryPage />} />
        <Route path="/e/:id/edit" element={<ExpenseFormPage />} />
        <Route path="/settle/:kind/:id" element={<SettleUpPage />} />
        <Route path="/treat" element={<TreatPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {NAV_ROUTES.includes(location.pathname) ? <BottomNav /> : null}
    </>
  )
}
