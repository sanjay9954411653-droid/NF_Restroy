import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { BillingSettings, calcBill, normalizeBilling } from './billing'

let cached: { at: number; promise: Promise<BillingSettings> } | null = null
function getBillingSettings(): Promise<BillingSettings> {
  if (!cached || Date.now() - cached.at > 60_000) {
    const promise = api.get('/restaurants/me').then((res) => normalizeBilling(res.data.data))
    promise.catch(() => { cached = null })
    cached = { at: Date.now(), promise }
  }
  return cached.promise
}

/**
 * Turns an order's item total (total_amount) into what the customer actually pays:
 * discount + service/other charges + GST — same as the Bill in the main app.
 * Returns the amount unchanged until the restaurant's bill settings have loaded.
 */
export function usePayable(): (amount: number) => number {
  const [billing, setBilling] = useState<BillingSettings | null>(null)
  useEffect(() => {
    let cancelled = false
    getBillingSettings().then((b) => { if (!cancelled) setBilling(b) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  return useCallback(
    (amount: number) => (billing ? Math.round(calcBill(Number(amount) || 0, billing).grandTotal * 100) / 100 : Number(amount) || 0),
    [billing],
  )
}
