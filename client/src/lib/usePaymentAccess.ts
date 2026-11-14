import { useEffect, useState } from 'react'
import api from '../api'
import { useAuth } from '../contexts/AuthContext'

/**
 * Admin can switch off "waiters can collect payment" (Users page).
 * Returns whether the signed-in user may take payment: admin / reception / kitchen
 * always can; a waiter only while the switch is on. The server enforces this too —
 * this just hides the buttons. A waiter sees no payment button until the setting loads.
 */
let cached: { at: number; promise: Promise<boolean> } | null = null
function loadWaiterAllowed(): Promise<boolean> {
  if (!cached || Date.now() - cached.at > 30_000) {
    const promise = api.get('/restaurants/me').then((res) => res.data.data?.waiter_can_collect_payment !== false)
    promise.catch(() => { cached = null })
    cached = { at: Date.now(), promise }
  }
  return cached.promise
}

export function useCanCollectPayment(): boolean {
  const { user } = useAuth()
  const isWaiter = user?.role === 'WAITER'
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    if (!isWaiter) return
    let cancelled = false
    loadWaiterAllowed().then((v) => { if (!cancelled) setAllowed(v) }).catch(() => {})
    return () => { cancelled = true }
  }, [isWaiter])
  return !isWaiter || allowed
}
