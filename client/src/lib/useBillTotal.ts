import { useEffect, useMemo, useState } from 'react'
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
