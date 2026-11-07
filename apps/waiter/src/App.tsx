import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/useAuthStore'
import { useMenuStore } from './store/useMenuStore'
import LoginPage    from './pages/LoginPage'
import TablesPage   from './pages/TablesPage'
import OrderPage    from './pages/OrderPage'
import MyOrdersPage from './pages/MyOrdersPage'
import ProfilePage  from './pages/ProfilePage'
import BottomNav    from './components/BottomNav'
import OfflineBanner from './components/OfflineBanner'
import TableRequestsBanner from './components/TableRequestsBanner'
import ConnectionBanner from './components/ConnectionBanner'
import { useTableRequestsStore } from './store/useTableRequestsStore'
import { useKotStation } from './hooks/useKotStation'
import { getKotPrefs } from './lib/kotPrinter'

// ── Protected wrapper ─────────────────────────────────────────────────────────
const Protected: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading } = useAuthStore()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-gray-200 border-t-indigo-600 animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

// ── Layout with bottom nav ────────────────────────────────────────────────────
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen pb-20">
    <OfflineBanner />
    <ConnectionBanner />
    <TableRequestsBanner />
    {children}
    <BottomNav />
  </div>
)
// ── App ───────────────────────────────────────────────────────────────────────
const App: React.FC = () => {
  const { restoreSession, user, token } = useAuthStore()
  const { fetchAll } = useMenuStore()
  const { connect, disconnect, fetchPending } = useTableRequestsStore()

  // Kitchen printer station (this device prints every new order's KOT to the WiFi printer)
  const [stationOn, setStationOn] = useState(() => getKotPrefs().station)
  useEffect(() => {
    const sync = () => setStationOn(getKotPrefs().station)
    window.addEventListener('kot-prefs-changed', sync)
    return () => window.removeEventListener('kot-prefs-changed', sync)
  }, [])
  useKotStation(!!user && stationOn)

  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  useEffect(() => {
    if (user) fetchAll()
  }, [user, fetchAll])

  // Live "Call Waiter" / "Request Bill" alerts (socket + initial fetch)
  useEffect(() => {
    if (!user?.restaurantId || !token) return
    connect(token, user.restaurantId)
    fetchPending()
    return () => disconnect()
  }, [user?.restaurantId, token, connect, disconnect, fetchPending])

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route path="/" element={
          <Protected>
            <AppLayout><TablesPage /></AppLayout>
          </Protected>
        } />

        <Route path="/orders" element={
          <Protected>
            <AppLayout><MyOrdersPage /></AppLayout>
          </Protected>
        } />

        <Route path="/profile" element={
          <Protected>
            <AppLayout><ProfilePage /></AppLayout>
          </Protected>
        } />

        {/* New order */}
        <Route path="/order/new" element={
          <Protected>
            <OrderPage />
          </Protected>
        } />

        {/* Add items to existing order */}
        <Route path="/order/add/:orderId" element={
          <Protected>
            <OrderPage />
          </Protected>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#1f2937',
            color: '#f9fafb',
            fontSize: '14px',
            borderRadius: '12px',
          },
        }}
      />
    </>
  )
}

export default App
