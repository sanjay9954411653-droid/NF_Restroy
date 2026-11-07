/**
 * Helpers for working out what the waiter needs to serve.
 *
 * An order can have several "rounds" (each time more items are added to the
 * table's order). The kitchen finishes rounds independently, so the waiter
 * gets to serve each round as soon as it is ready.
 */

import type { Order, OrderItem } from '../types'

export interface ReadyRound {
  order: Order
  round: number
  totalRounds: number
  items: OrderItem[] // items of this round that haven't been served yet
}

export function orderItemsOf(order: Order): OrderItem[] {
  return (order.order_items || order.items || []) as OrderItem[]
}

/** Rounds that are finished in the kitchen and still waiting to be served. */
export function getReadyRounds(order: Order): ReadyRound[] {
  if (['COMPLETED', 'CANCELLED'].includes(order.status)) return []
  const items = orderItemsOf(order)
  const byRound = new Map<number, OrderItem[]>()
  for (const it of items) {
    const r = it.round || 1
    if (!byRound.has(r)) byRound.set(r, [])
    byRound.get(r)!.push(it)
  }
  const orderReady = order.status === 'READY'
  const out: ReadyRound[] = []
  for (const [round, roundItems] of Array.from(byRound.entries()).sort((a, b) => a[0] - b[0])) {
    const unserved = roundItems.filter((i) => !i.served_at)
    if (unserved.length === 0) continue
    // A round is ready when all its items are DONE — or the whole order was set to READY
    const roundDone = roundItems.every((i) => i.status === 'DONE')
    if (orderReady || roundDone) out.push({ order, round, totalRounds: byRound.size, items: unserved })
  }
  return out
}

export function isFullyServed(order: Order): boolean {
  const items = orderItemsOf(order)
  return items.length > 0 && items.every((i) => !!i.served_at)
}

/** Orders from customers (QR / WhatsApp / Zomato / online) that wait for staff to accept them. */
export function isIncomingPending(order: Order): boolean {
  return order.status === 'CREATED' && !['WAITER', 'RECEPTION'].includes(order.order_source)
}

export const SOURCE_LABEL: Record<string, string> = {
  QR: 'QR order',
  WHATSAPP: 'WhatsApp order',
  ZOMATO: 'Zomato order',
}
