import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../api'
import { BillingSettings, calcBill, normalizeBilling } from './billing'
import type { Order, OrderItem } from '../types/order'
import { BillCoupon, BillRestaurant, computeBill, loadBillingContext } from './billPrint'

/**
 * The amount the customer really pays (items + discount/coupon + service &
 * other charges + GST) — identical to the Bill screen and the payment form.
 * Returns null until the restaurant's bill settings have loaded.
 */
export function useGrandTotal(order: Order | null, items: OrderItem[]): number | null {
  const [ctx, setCtx] = useState<{ restaurant: BillRestaurant; coupon: BillCoupon } | null>(null)
  const orderId = order?.id
  const itemCount = items.length
  const orderTotal = order?.total_amount

  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    loadBillingContext(orderId)
      .then((c) => { if (!cancelled) setCtx(c) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [orderId, itemCount, orderTotal])

  return useMemo(
    () => (ctx && order ? Math.round(computeBill({ order, items, ...ctx }).grandTotal * 100) / 100 : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, orderId, itemCount, orderTotal],
  )
}

// ── Amount payable for lists (orders / floor) where only total_amount is known ──
let cachedBilling: { at: number; promise: Promise<BillingSettings> } | null = null
function getBillingSettings(): Promise<BillingSettings> {
  if (!cachedBilling || Date.now() - cachedBilling.at > 60_000) {
    const promise = api.get('/restaurants/me').then((res) => normalizeBilling(res.data.data))
    promise.catch(() => { cachedBilling = null })
    cachedBilling = { at: Date.now(), promise }
  }
  return cachedBilling.promise
}

/**
 * Returns a function that turns an order's item total (total_amount) into what the
 * customer actually pays: discount + service/other charges + GST — same as the Bill.
 * Until the restaurant's settings load it returns the amount unchanged.
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
