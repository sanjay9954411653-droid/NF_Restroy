import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuthStore } from '../store/useAuthStore'

/**
 * Admin can switch off "waiters can collect payment". Returns whether this waiter may
 * take payment. The server enforces it too — this just hides the Collect Payment button.
 * The button stays hidden until the setting has loaded.
 */
let cached: { at: number; promise: Promise<boolean> } | null = null
function loadAllowed(): Promise<boolean> {
  if (!cached || Date.now() - cached.at > 30_000) {
    const promise = api.get('/restaurants/me').then((res) => res.data.data?.waiter_can_collect_payment !== false)
    promise.catch(() => { cached = null })
    cached = { at: Date.now(), promise }
  }
  return cached.promise
}

export function useCanCollectPayment(): boolean {
  const role = useAuthStore((s) => s.user?.role)
  const needsCheck = !role || role === 'WAITER'
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    if (!needsCheck) return
    let cancelled = false
    loadAllowed().then((v) => { if (!cancelled) setAllowed(v) }).catch(() => {})
    return () => { cancelled = true }
  }, [needsCheck])
  return !needsCheck || allowed
}
