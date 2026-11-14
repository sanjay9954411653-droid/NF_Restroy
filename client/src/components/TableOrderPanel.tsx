/**
 * TableOrderPanel — slide-over drawer shown when a waiter/receptionist taps an
 * OCCUPIED table on the Tables command-center screen.
 *
 * It loads the table's active order in full (with line items) and exposes the
 * one-tap actions staff need at the table side:
 *   - Add Items      → re-opens the POS order form for this table (running tab)
 *   - Advance status → Accept / Start Prep / Mark Ready / Complete
 *   - Print KOT      → kitchen ticket (thermal)
 *   - Print Bill     → customer receipt (thermal)
 *   - Collect Payment→ opens the payment form for this order
 *
 * Data: GET /orders/:id (returns order + items + table). We refetch via the
 * `refreshKey` prop so the parent can force a reload after an action.
 */
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import { Order, OrderStatus, OrderItem } from '../types/order'
import { formatCurrency, formatRelative } from '../lib/utils'
import { formatWeight } from '../lib/weight'
import Button from './Button'
import Badge from './Badge'
import CancelItemsSheet from './CancelItemsSheet'
import { printKOT } from './PrintKOT'
import { printReceipt } from './PrintReceipt'
import { useGrandTotal } from '../lib/useBillTotal'
import { useCanCollectPayment } from '../lib/usePaymentAccess'
import {
  XMarkIcon,
  PlusIcon,
  PrinterIcon,
  CurrencyDollarIcon,
  ArrowRightIcon,
  ReceiptPercentIcon,
} from '@heroicons/react/24/outline'

const STATUS_BADGE: Record<OrderStatus, { variant: any; label: string }> = {
  CREATED:   { variant: 'default', label: 'New' },
  ACCEPTED:  { variant: 'info',    label: 'Accepted' },
  PREPARING: { variant: 'warning', label: 'Preparing' },
  READY:     { variant: 'success', label: 'Ready' },
  COMPLETED: { variant: 'success', label: 'Completed' },
  CANCELLED: { variant: 'error',   label: 'Cancelled' },
}

// Safe lookup — never throws if status is missing/unknown
const FALLBACK_BADGE = { variant: 'default' as any, label: 'Unknown' }
function statusBadge(status?: string) {
  return (status && STATUS_BADGE[status as OrderStatus]) || FALLBACK_BADGE
}

// Next workflow step for kitchen stages only — READY is handled via payment
const NEXT_ACTION: Partial<Record<OrderStatus, { next: OrderStatus; label: string }>> = {
  CREATED:   { next: 'ACCEPTED',  label: 'Accept Order' },
  ACCEPTED:  { next: 'PREPARING', label: 'Start Preparing' },
  PREPARING: { next: 'READY',     label: 'Mark Ready' },
}

interface TableOrderPanelProps {
  tableNumber: string
  orderId: string
  /** Small heading above the name: "Table" (default) or e.g. "Pick-up order" */
  kindLabel?: string
  restaurantName?: string
  /** Several guests on one table: one chip per open order, plus an optional "+ New" chip */
  orders?: { id: string; label: string; amount: string; status?: string }[]
  /** Guest letter (A, B, C…) of the order being shown */
  guestLabel?: string
  onSelectOrder?: (id: string) => void
  onNewOrder?: () => void
  refreshKey?: number
  onClose: () => void
  onAddItems: () => void
  onCollectPayment: () => void
  onChanged: () => void // tell parent to refetch table occupancy
}

const TableOrderPanel: React.FC<TableOrderPanelProps> = ({
  tableNumber,
  orderId,
  kindLabel = 'Table',
  restaurantName = 'Restaurant',
  orders,
  guestLabel,
  onSelectOrder,
  onNewOrder,
  refreshKey = 0,
  onClose,
  onAddItems,
  onCollectPayment,
  onChanged,
}) => {
  const [order, setOrder] = useState<Order | null>(null)
  const [allItems, setAllItems] = useState<OrderItem[]>([])
  const [cancelOpen, setCancelOpen] = useState(false)
  // Cancelled lines stay in the database (audit trail) but are not part of the bill, KOT or total
  const items = allItems.filter((i) => i.status !== 'CANCELLED')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const grandTotal = useGrandTotal(order, items)
  const canCollect = useCanCollectPayment()

  const loadOrder = async () => {
    try {
      const res = await api.get(`/orders/${orderId}`)
      // The API returns { order: {...}, items: [...] } — unwrap it.
      // Fall back to a flat shape in case the endpoint ever returns the order directly.
      const data = res.data.data
      const ord = data?.order ?? data
      setOrder(ord)
      setAllItems(ord?.items || ord?.order_items || data?.items || [])
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    loadOrder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, refreshKey])

  const advance = async () => {
    if (!order) return
    const action = NEXT_ACTION[order.status]
    if (!action) return
    setBusy(true)
    try {
      await api.patch(`/orders/${order.id}`, { status: action.next })
      toast.success(`Order → ${action.next.toLowerCase()}`)
      await loadOrder()
      onChanged()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const action = order ? NEXT_ACTION[order.status] : undefined

  return (
    <div className="fixed inset-0 z-40 flex animate-fade-in">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative ml-auto w-full max-w-md bg-white shadow-2xl flex flex-col h-full animate-slide-up">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">{kindLabel}</p>
            <h2 className="text-xl font-bold text-gray-900 leading-none mt-0.5">{tableNumber}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Guest tabs — every open order on this table (guest A, B, ...) */}
        {orders && orders.length > 0 && (orders.length > 1 || onNewOrder) && (
          <div className="px-5 py-3 border-b border-gray-100 flex gap-2 overflow-x-auto shrink-0">
            {orders.map((o) => (
              <button
                key={o.id}
                onClick={() => onSelectOrder?.(o.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  o.id === orderId
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                }`}
              >
                {o.label} · {o.amount}
                {o.status === 'READY' && <span className="ml-1">✓</span>}
              </button>
            ))}
            {onNewOrder && (
              <button
                onClick={onNewOrder}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:border-indigo-400 hover:text-indigo-600"
              >
                + New order
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="h-10 w-10 rounded-full border-2 border-gray-200 border-t-indigo-600 animate-spin" />
          </div>
        ) : !order ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            Order not found
          </div>
        ) : (
          <>
            {/* Order summary */}
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900 flex items-center gap-2">
                    {guestLabel && (
                      <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-lg bg-indigo-600 text-white text-sm font-bold">
                        {guestLabel}
                      </span>
                    )}
                    {order.order_number}
                  </span>
                  <Badge variant={statusBadge(order.status).variant} dot>
                    {statusBadge(order.status).label}
                  </Badge>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {order.order_type === 'PARCEL' ? 'Pick-up' : order.order_type} · {order.order_source} · {formatRelative(order.created_at)}
                </p>
              </div>

              {/* Items */}
              <div className="px-5 py-3 divide-y divide-gray-50">
                {items.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">No items</p>
                ) : (
                  items.map((it, i) => (
                    <div key={it.id || i} className="flex items-start justify-between gap-3 py-2">
                      <div className="flex gap-2 min-w-0">
                        <span className="text-sm font-bold text-gray-700 shrink-0">{it.weight_grams ? formatWeight(it.weight_grams) : `${it.quantity}×`}</span>
                        <div className="min-w-0">
                          <p className="text-sm text-gray-900 leading-tight">
                            {it.menu_item_name || it.menu_item_id}
                          </p>
                          {it.modifiers && it.modifiers.length > 0 && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              {it.modifiers.map((m, mi) => {
                                const adj = Number(m.price_adjustment || 0)
                                return (
                                  <span key={mi}>
                                    {mi > 0 && ', '}
                                    {m.modifier_option_name}
                                    {adj > 0 ? ` (+₹${adj})` : adj < 0 ? ` (-₹${Math.abs(adj)})` : ''}
                                  </span>
                                )
                              })}
                            </p>
                          )}
                          {it.special_instructions && (
                            <p className="text-xs text-gray-400 mt-0.5">📝 {it.special_instructions}</p>
                          )}
                        </div>
                      </div>
                      <span className="text-sm text-gray-600 shrink-0">
                        {formatCurrency(Number(it.unit_price || 0) * it.quantity)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {order.special_instructions && (
                <div className="px-5 py-3 bg-amber-50 border-y border-amber-100">
                  <p className="text-xs text-amber-800">
                    <span className="font-semibold">Note:</span> {order.special_instructions}
                  </p>
                </div>
              )}

              {/* Total */}
              <div className="px-5 py-4 flex items-center justify-between">
                <span className="text-sm text-gray-500">Total</span>
                <span className="text-2xl font-bold text-gray-900">
                  {formatCurrency(grandTotal ?? Number(order.total_amount || 0))}
                </span>
              </div>
            </div>

            {/* Action footer */}
            <div className="border-t border-gray-100 px-4 pt-4 footer-safe space-y-2 shrink-0">
              {/* READY → Collect Payment is the single primary action */}
              {order.status === 'READY' && canCollect && (
                <Button
                  variant="primary"
                  fullWidth
                  size="lg"
                  leftIcon={<CurrencyDollarIcon className="w-4 h-4" />}
                  onClick={onCollectPayment}
                >
                  Collect Payment
                </Button>
              )}

              {/* Kitchen stages → advance button */}
              {action && order.status !== 'READY' && (
                <Button
                  variant="primary"
                  fullWidth
                  size="lg"
                  isLoading={busy}
                  rightIcon={<ArrowRightIcon className="w-4 h-4" />}
                  onClick={advance}
                >
                  {action.label}
                </Button>
              )}

              {/* Secondary actions grid */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  leftIcon={<PlusIcon className="w-4 h-4" />}
                  onClick={onAddItems}
                >
                  Add Items
                </Button>
                <Button
                  variant="outline"
                  leftIcon={<PrinterIcon className="w-4 h-4" />}
                  onClick={() => printKOT(order, items, restaurantName)}
                >
                  Print KOT
                </Button>
                <Button
                  variant="outline"
                  leftIcon={<ReceiptPercentIcon className="w-4 h-4" />}
                  onClick={() => printReceipt(order, items, restaurantName)}
                >
                  Print Bill
                </Button>
                {order.status !== 'READY' && canCollect && (
                  <Button
                    variant="secondary"
                    leftIcon={<CurrencyDollarIcon className="w-4 h-4" />}
                    onClick={onCollectPayment}
                  >
                    Collect Pay
                  </Button>
                )}
              </div>

              {/* Cancel items — only while the order is still open */}
              {!['COMPLETED', 'CANCELLED'].includes(order.status) && items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCancelOpen(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  <XMarkIcon className="w-4 h-4" /> Cancel items
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {cancelOpen && order && (
        <CancelItemsSheet
          orderId={order.id}
          orderNumber={order.order_number}
          title={`${kindLabel} ${tableNumber}`}
          items={items}
          onClose={() => setCancelOpen(false)}
          onDone={async () => {
            setCancelOpen(false)
            await loadOrder()
            onChanged()
          }}
        />
      )}
    </div>
  )
}

export default TableOrderPanel
