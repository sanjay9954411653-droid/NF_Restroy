import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/useAuthStore'
import KotPrinterCard from '../components/KotPrinterCard'
import { enablePushNotifications, disablePushNotifications, getPushStatus, getPushSupport, PushStatus } from '../lib/push'

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  WAITER: 'Waiter',
  RECEPTION: 'Reception',
  KITCHEN: 'Kitchen',
}

const ProfilePage: React.FC = () => {
  const { user, logout } = useAuthStore()
  const [confirming, setConfirming] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [pushStatus, setPushStatus] = useState<PushStatus>('default')
  const [pushBusy, setPushBusy] = useState(false)

  useEffect(() => {
    setPushStatus(getPushStatus())
  }, [])

  const handleTogglePush = async () => {
    setPushBusy(true)
    try {
      if (pushStatus === 'granted') {
        await disablePushNotifications()
        setPushStatus('default')
      } else {
        const ok = await enablePushNotifications()
        setPushStatus(ok ? 'granted' : getPushStatus())
      }
    } finally {
      setPushBusy(false)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    await logout() // clears the session locally either way — see useAuthStore
  }

  return (
    <div className="p-4 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Profile</h1>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xl font-bold shrink-0">
            {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">{user?.name || 'Staff'}</p>
            <p className="text-sm text-gray-500 truncate">{user?.email}</p>
            {user?.role && (
              <span className="inline-block mt-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
                {ROLE_LABELS[user.role] || user.role}
              </span>
            )}
          </div>
        </div>
      </div>

      {getPushSupport() && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 text-sm">Call Waiter alerts</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {pushStatus === 'denied'
                  ? 'Blocked in browser settings — enable notifications for this site to turn it back on.'
                  : 'Ring this device even when the app is in the background or the screen is locked.'}
              </p>
            </div>
            <button
              onClick={handleTogglePush}
              disabled={pushBusy || pushStatus === 'denied'}
              className={`shrink-0 px-4 py-2 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50 ${
                pushStatus === 'granted'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {pushBusy ? '…' : pushStatus === 'granted' ? 'On' : 'Turn on'}
            </button>
          </div>
        </div>
      )}

      <KotPrinterCard />

      <p className="text-xs text-gray-400 px-1">
        You'll stay signed in on this device between shifts. Log out only if this device is shared or you're switching accounts.
      </p>

      {confirming ? (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 space-y-3">
          <p className="text-sm text-red-800">Log out of this device?</p>
          <div className="flex gap-2">
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50"
            >
              {loggingOut ? 'Logging out…' : 'Yes, log out'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={loggingOut}
              className="px-4 py-2.5 text-sm font-semibold text-gray-600 rounded-xl border border-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="w-full py-3 text-sm font-semibold text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50"
        >
          Log out
        </button>
      )}
    </div>
  )
}

export default ProfilePage
