/**
 * MyOrdersPage — the waiter's view of today's active orders.
 *
 * The waiter normally leaves kitchen stages to the kitchen. Restaurants with no
 * kitchen screen use [Mark ready] on an "In kitchen" order instead, and accept
 * customer (QR / online) orders themselves. Flow:
 *   0. "New customer orders" — tap [Accept] (or [Reject]); accepting sends the KOT.
 *   1. "Ready to serve"   — the kitchen finished a round; tap [Serve Order].
 *   2. "Awaiting payment" — the whole order is ready; tap [Collect Payment].
 *   3. "In kitchen"       — read-only progress, plus [Add] to send more items.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { PlusIcon, CurrencyDollarIcon, XMarkIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { useOrderStore } from '../store/useOrderStore'
import { ordersApi, paymentsApi, PaymentMethod } from '../api/endpoints'
import { formatDistanceToNow } from 'date-fns'
import type { Order, OrderStatus } from '../types'
import { getReadyRounds, isFullyServed, orderItemsOf, isIncomingPending, SOURCE_LABEL } from '../lib/orderRounds'
import { usePayable } from '../lib/usePayable'

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n)

const STATUS_COLOR: Record<OrderStatus, string> = {
  CREATED:   'bg-gray-100 text-gray-700',
  ACCEPTED:  'bg-blue-100 text-blue-700',
  PREPARING: 'bg-amber-100 text-amber-700',
  READY:     'bg-emerald-100 text-emerald-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
}

// Friendly, read-only labels for what the kitchen is doing
const KITCHEN_LABEL: Partial<Record<OrderStatus, string>> = {
  CREATED:   'Sent to kitchen',
  ACCEPTED:  'Accepted',
  PREPARING: 'Preparing',
}

const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'UPI', 'ONLINE']

// ── Inline payment sheet ────────────────────────────────────────────────────

interface PaymentSheetProps {
  order: Order
  onClose: () => void
  onPaid: () => void
}

type PaymentLine = {
  id: number
  method: PaymentMethod
  amount: number
  reference: string
}

const makePaymentLine = (id: number, amount = 0): PaymentLine => ({
  id,
  method: 'CASH',
  amount,
  reference: '',
})

const PaymentSheet: React.FC<PaymentSheetProps> = ({ order, onClose, onPaid }) => {
  // What is actually left to collect: the bill's grand total (GST + charges,
  // minus any coupon) minus anything already paid. Loaded from the server so
  // it always matches what the server will accept.
  const [total, setTotal] = useState(Number(order.total_amount || 0))
  const [billTotal, setBillTotal] = useState(0)
  const [alreadyPaid, setAlreadyPaid] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState<'single' | 'split'>('single')
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [amount, setAmount] = useState(total)
  const [reference, setReference] = useState('')
  const [splits, setSplits] = useState<PaymentLine[]>([makePaymentLine(1, total)])
  const [saving, setSaving] = useState(false)

  const fmt2 = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n)

  useEffect(() => {
    let cancelled = false
    paymentsApi
      .balance(order.id)
      .then((res) => {
        if (cancelled) return
        const d = res.data.data
        setBillTotal(d.total)
        setAlreadyPaid(d.paid)
        setTotal(d.balance)
        setAmount(d.balance)
        setSplits((prev) =>
          prev.length >= 2 ? [makePaymentLine(1, d.balance), makePaymentLine(2, 0)] : [makePaymentLine(1, d.balance)],
        )
        setLoaded(true)
      })
      .catch(() => {
        // Older backend without the balance endpoint: fall back to the old total
        if (!cancelled) setLoaded(true)
      })
    return () => { cancelled = true }
  }, [order.id])

  const splitTotal = splits.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  const remaining = Math.max(0, total - splitTotal)

  const updateSplit = (id: number, updates: Partial<PaymentLine>) => {
    setSplits((prev) => {
      const next = prev.map((line) => (line.id === id ? { ...line, ...updates } : line))
      // Autofill: when an amount is typed on any line except the last, the last
      // line takes whatever is still left to collect. (Typing on the last line
      // leaves the others alone and the "Remaining" figure shows what's short.)
      const last = next[next.length - 1]
      if ('amount' in updates && next.length > 1 && last.id !== id) {
        const others = next.slice(0, -1).reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
        next[next.length - 1] = { ...last, amount: Math.max(0, Math.round((total - others) * 100) / 100) }
      }
      return next
    })
  }

  const addSplit = () => {
    const nextId = Math.max(0, ...splits.map((s) => s.id)) + 1
    setSplits((prev) => [...prev, makePaymentLine(nextId, 0)])
  }

  const removeSplit = (id: number) => {
    if (splits.length <= 2) return
    setSplits((prev) => prev.filter((line) => line.id !== id))
  }

  const validateLine = (line: PaymentLine) => {
    if (line.amount <= 0) {
      toast.error('Each split amount must be greater than ₹0')
      return false
    }
    return true
  }

  const handlePay = async () => {
    if (saving) return

    if (mode === 'single') {
      if (amount <= 0) {
        toast.error('Enter a valid amount')
        return
      }
      if (amount > total + 0.01) {
        toast.error(`Amount cannot exceed ${fmt2(total)}`)
        return
      }
    } else {
      if (splits.length < 2) {
        toast.error('Add at least two payments for split payment')
        return
      }
      if (Math.abs(splitTotal - total) > 0.01) {
        toast.error(`Split total must equal ${formatCurrency(total)}. Remaining: ${formatCurrency(Math.max(0, total - splitTotal))}`)
        return
      }
      if (!splits.every(validateLine)) return
    }

    setSaving(true)
    try {
      if (mode === 'single') {
        await paymentsApi.create({
          order_id: order.id,
          amount,
          method,
          status: 'PAID',
          reference_number: reference.trim() || undefined,
        })
      } else {
        // Create each split as a separate payment record. The backend locks the
        // order while inserting each payment and automatically completes it
        // when the final split reaches the full order total.
        for (const line of splits) {
          await paymentsApi.create({
            order_id: order.id,
            amount: Number(line.amount),
            method: line.method,
            status: 'PAID',
            reference_number: line.reference.trim() || undefined,
          })
        }
      }

      toast.success(mode === 'split' ? 'Split payment recorded ✓' : 'Payment recorded ✓')
      onPaid()
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Payment failed')
    } finally {
      setSaving(false)
    }
  }

  const switchMode = (nextMode: 'single' | 'split') => {
    setMode(nextMode)
    if (nextMode === 'split') {
      setSplits([makePaymentLine(1, total), makePaymentLine(2, 0)])
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full bg-white rounded-t-2xl p-5 space-y-4 animate-slide-up max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-gray-900 text-lg">Collect Payment</p>
            <p className="text-sm text-gray-500">{order.order_number}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100">
            <XMarkIcon className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Total */}
        <div className="bg-indigo-50 rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-indigo-700">Total due</span>
          <span className="text-2xl font-bold text-indigo-700">{loaded ? fmt2(total) : '…'}</span>
        </div>
        {loaded && alreadyPaid > 0 && (
          <p className="text-xs text-gray-500 -mt-2">
            Bill {fmt2(billTotal)} · already paid {fmt2(alreadyPaid)}
          </p>
        )}

        {/* Payment mode */}
        <div className="grid grid-cols-2 gap-2 bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => switchMode('single')}
            className={`py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              mode === 'single' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'
            }`}
          >
            Single Payment
          </button>
          <button
            onClick={() => switchMode('split')}
            className={`py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              mode === 'split' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'
            }`}
          >
            Split Payment
          </button>
        </div>

        {mode === 'single' ? (
          <>
            {/* Amount input */}
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Amount collected</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">₹</span>
                <input
                  type="number"
                  step="0.01"
                  min={0.01}
                  max={total}
                  value={amount || ''}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  className="input pl-7 text-lg font-bold"
                />
              </div>
              {amount < total && amount > 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  Remaining balance: {formatCurrency(total - amount)}
                </p>
              )}
            </div>

            {/* Method */}
            <div>
              <label className="text-xs font-medium text-gray-500 mb-2 block">Payment method</label>
              <div className="grid grid-cols-4 gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`py-2.5 text-sm font-semibold rounded-xl border transition-colors ${
                      method === m
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Reference for non-cash */}
            {method !== 'CASH' && (
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">
                  Reference / UTR (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. TXN123456"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="input text-sm"
                />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Split summary */}
            <div className={`rounded-xl px-4 py-3 flex items-center justify-between ${
              Math.abs(splitTotal - total) <= 0.01 ? 'bg-emerald-50' : 'bg-amber-50'
            }`}>
              <div>
                <p className="text-xs text-gray-500">Split total</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(splitTotal)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Remaining</p>
                <p className={`text-lg font-bold ${remaining <= 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {formatCurrency(remaining)}
                </p>
              </div>
            </div>

            {/* Split rows */}
            <div className="space-y-3">
              {splits.map((line, index) => (
                <div key={line.id} className="rounded-xl border border-gray-200 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800">Payment {index + 1}</span>
                    {splits.length > 2 && (
                      <button
                        onClick={() => removeSplit(line.id)}
                        className="text-xs font-medium text-red-500"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m}
                        onClick={() => updateSplit(line.id, { method: m })}
                        className={`py-2 text-xs font-semibold rounded-lg border transition-colors ${
                          line.method === m
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-gray-600 border-gray-200'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">₹</span>
                    <input
                      type="number"
                      step="0.01"
                      min={0.01}
                      value={line.amount || ''}
                      onChange={(e) => updateSplit(line.id, { amount: parseFloat(e.target.value) || 0 })}
                      className="input pl-7 font-bold"
                      placeholder="Amount"
                    />
                  </div>

                  {line.method !== 'CASH' && (
                    <input
                      type="text"
                      placeholder="Reference / UTR (optional)"
                      value={line.reference}
                      onChange={(e) => updateSplit(line.id, { reference: e.target.value })}
                      className="input text-sm"
                    />
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addSplit}
              className="w-full py-2.5 rounded-xl border-2 border-dashed border-indigo-200 text-indigo-600 font-semibold text-sm hover:bg-indigo-50"
            >
              + Add another payment
            </button>
          </>
        )}

        {/* Confirm */}
        <button
          onClick={handlePay}
          disabled={saving || !loaded || total <= 0}
          className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-base font-semibold"
        >
          {saving ? (
            <span className="w-5 h-5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
          ) : (
            <CurrencyDollarIcon className="w-5 h-5" />
          )}
          {saving
            ? 'Recording…'
            : mode === 'split'
              ? `Confirm Split — ${fmt2(splitTotal)}`
              : `Confirm — ${fmt2(amount)}`}
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const MyOrdersPage: React.FC = () => {
  const payable = usePayable()
  const navigate = useNavigate()
  const { orders, queue, isLoading, fetchOrders, serve, markRoundReady, updateStatus } = useOrderStore()
  const [payingOrder, setPayingOrder] = useState<Order | null>(null)
  const [servingKey, setServingKey] = useState<string | null>(null)
  const [readyKey, setReadyKey] = useState<string | null>(null)       // round being saved
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)   // round awaiting a second tap

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const incomingOrders = orders.filter(isIncomingPending)
  const kitchenOrders = orders.filter(
    (o) => ['CREATED', 'ACCEPTED', 'PREPARING'].includes(o.status) && !isIncomingPending(o)
  )
  const readyOrders = orders.filter((o) => o.status === 'READY')
  const readyRounds = orders.flatMap((o) => getReadyRounds(o))

  const handleServe = async (order: Order, round: number, totalRounds: number) => {
    const key = `${order.id}-${round}`
    setServingKey(key)
    try {
      await serve(order.id, totalRounds > 1 ? round : undefined)
      toast.success('Marked as served ✓')
    } catch {
      toast.error('Failed to mark as served')
    } finally {
      setServingKey(null)
    }
  }

  // First tap asks "Tap again", second tap marks the round's unfinished items as ready.
  const handleMarkReady = async (order: Order, round: number, itemIds: string[]) => {
    const key = `${order.id}-${round}`
    if (confirmKey !== key) {
      setConfirmKey(key)
      setTimeout(() => setConfirmKey((k) => (k === key ? null : k)), 4000)
      return
    }
    setConfirmKey(null)
    setReadyKey(key)
    try {
      await markRoundReady(order.id, itemIds)
      toast.success('Marked ready ✓')
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Could not mark ready')
    } finally {
      setReadyKey(null)
    }
  }

  // Accept sends the order to the kitchen (and prints its KOT). Reject needs a second tap.
  const handleDecision = async (order: Order, decision: 'ACCEPTED' | 'CANCELLED') => {
    const key = `${order.id}-${decision}`
    if (decision === 'CANCELLED' && confirmKey !== key) {
      setConfirmKey(key)
      setTimeout(() => setConfirmKey((k) => (k === key ? null : k)), 4000)
      return
    }
    setConfirmKey(null)
    setDecidingId(order.id)
    try {
      await updateStatus(order.id, decision)
      toast.success(decision === 'ACCEPTED' ? 'Order accepted ✓' : 'Order rejected')
      await fetchOrders()
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Could not update the order')
      fetchOrders()
    } finally {
      setDecidingId(null)
    }
  }

  const handlePaid = () => {
    setPayingOrder(null)
    fetchOrders()
  }

  const totalActive = incomingOrders.length + kitchenOrders.length + readyOrders.length

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <p className="text-sm text-gray-500">{totalActive} active</p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="btn-primary flex items-center gap-2 py-2 px-4 text-sm"
        >
          <PlusIcon className="w-4 h-4" />
          New
        </button>
      </div>

      {/* Offline queue banner */}
      {queue.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
          <span className="text-amber-500 text-xl">📶</span>
          <div>
            <p className="text-sm font-medium text-amber-800">
              {queue.length} order{queue.length > 1 ? 's' : ''} queued offline
            </p>
            <p className="text-xs text-amber-600">Will sync when back online</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 rounded-full border-2 border-gray-200 border-t-indigo-600 animate-spin" />
        </div>
      ) : totalActive === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-4xl mb-3">🍽️</p>
          <p className="font-semibold text-gray-900">No active orders</p>
          <p className="text-sm text-gray-500 mt-1">Tap "New" to take an order</p>
        </div>
      ) : (
        <>
          {/* 0. New customer orders (QR / online) — waiter accepts or rejects */}
          {incomingOrders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-red-600 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                New customer orders ({incomingOrders.length})
              </h2>
              {incomingOrders.map((order) => {
                const items = orderItemsOf(order)
                const deciding = decidingId === order.id
                const rejecting = confirmKey === `${order.id}-CANCELLED`
                return (
                  <div key={order.id} className="card p-4 space-y-3 border-l-4 border-l-red-400">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-gray-900">
                          {order.table?.table_number ? `Table ${order.table.table_number}` : (order.order_type === 'PARCEL' ? 'Pick-up' : order.order_type)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {order.order_number} · {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
                        {SOURCE_LABEL[order.order_source] || 'Online order'}
                      </span>
                    </div>
                    <ul className="text-sm text-gray-700 space-y-0.5">
                      {items.map((it, i) => (
                        <li key={it.id || i}>
                          <span className="font-semibold">{it.quantity}×</span> {it.menu_item_name || 'Item'}
                          {it.special_instructions && <span className="text-gray-400"> — {it.special_instructions}</span>}
                        </li>
                      ))}
                    </ul>
                    {order.special_instructions && (
                      <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">Note: {order.special_instructions}</p>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                      <span className="font-bold text-gray-900">{formatCurrency(payable(Number(order.total_amount)))}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDecision(order, 'ACCEPTED')}
                        disabled={deciding}
                        className="btn-primary flex-1 flex items-center justify-center gap-2 py-3 disabled:opacity-60"
                      >
                        <CheckCircleIcon className="w-5 h-5" />
                        {deciding ? 'Saving…' : 'Accept'}
                      </button>
                      <button
                        onClick={() => handleDecision(order, 'CANCELLED')}
                        disabled={deciding}
                        className={`px-4 py-3 rounded-xl text-sm font-semibold border disabled:opacity-60 ${
                          rejecting ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-600 border-red-200'
                        }`}
                      >
                        {rejecting ? 'Tap again' : 'Reject'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {/* 1. Ready to serve — one card per finished round */}
          {readyRounds.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-emerald-700 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Ready to serve ({readyRounds.length})
              </h2>
              {readyRounds.map(({ order, round, totalRounds, items }) => {
                const key = `${order.id}-${round}`
                return (
                  <div key={key} className="card p-4 space-y-3 border-l-4 border-l-emerald-400">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-gray-900">
                          {order.table?.table_number ? `Table ${order.table.table_number}` : (order.order_type === 'PARCEL' ? 'Pick-up' : order.order_type)}
                          {totalRounds > 1 && (
                            <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
                              Round {round}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">{order.order_number}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLOR['READY']}`}>
                        Ready
                      </span>
                    </div>
                    <ul className="text-sm text-gray-700 space-y-0.5">
                      {items.map((it, i) => (
                        <li key={it.id || i}>
                          <span className="font-semibold">{it.quantity}×</span> {it.menu_item_name || 'Item'}
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => handleServe(order, round, totalRounds)}
                      disabled={servingKey === key}
                      className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-60"
                    >
                      <CheckCircleIcon className="w-5 h-5" />
                      {servingKey === key ? 'Saving…' : 'Serve Order'}
                    </button>
                  </div>
                )
              })}
            </section>
          )}

          {/* 2. Awaiting payment — whole order is ready */}
          {readyOrders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-indigo-700">
                Awaiting payment ({readyOrders.length})
              </h2>
              {readyOrders.map((order) => {
                const itemCount = orderItemsOf(order).length
                const served = isFullyServed(order)
                return (
                  <div key={order.id} className="card p-4 space-y-3 border-l-4 border-l-indigo-400">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-gray-900">{order.order_number}</p>
                        <p className="text-xs text-gray-500">
                          {order.table?.table_number ? `Table ${order.table.table_number}` : (order.order_type === 'PARCEL' ? 'Pick-up' : order.order_type)}
                          {' · '}
                          {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${served ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {served ? 'Served ✓' : 'Not served yet'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                      <span className="font-bold text-gray-900 text-lg">{formatCurrency(payable(Number(order.total_amount)))}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPayingOrder(order)}
                        className="btn-primary flex-1 flex items-center justify-center gap-2 py-3"
                      >
                        <CurrencyDollarIcon className="w-5 h-5" />
                        Collect Payment
                      </button>
                      <button
                        onClick={() => navigate(`/order/add/${order.id}?table=${order.table?.table_number || ''}`)}
                        className="btn-secondary flex items-center gap-1.5 py-3 px-3 text-sm"
                        title="Add more items"
                      >
                        <PlusIcon className="w-4 h-4" />
                        Add
                      </button>
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {/* 3. In kitchen — read-only progress */}
          {kitchenOrders.length > 0 && (
            <section className="space-y-3">
              {(incomingOrders.length > 0 || readyRounds.length > 0 || readyOrders.length > 0) && (
                <h2 className="text-sm font-semibold text-gray-500">In kitchen ({kitchenOrders.length})</h2>
              )}
              {kitchenOrders.map((order) => {
                const items = orderItemsOf(order)
                const doneCount = items.filter((i) => i.status === 'DONE').length
                // Rounds that still have food to finish (only once the restaurant accepted the order)
                const pendingRounds = ['ACCEPTED', 'PREPARING'].includes(order.status)
                  ? Array.from(
                      items
                        .filter((i) => (i.status as string) !== 'DONE' && (i.status as string) !== 'CANCELLED')
                        .reduce((m, i) => m.set(i.round || 1, [...(m.get(i.round || 1) || []), i]), new Map<number, typeof items>()),
                    ).sort((a, b) => a[0] - b[0])
                  : []
                return (
                  <div key={order.id} className="card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-gray-900">{order.order_number}</p>
                        <p className="text-xs text-gray-500">
                          {order.table?.table_number ? `Table ${order.table.table_number}` : (order.order_type === 'PARCEL' ? 'Pick-up' : order.order_type)}
                          {' · '}
                          {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLOR[order.status]}`}>
                        {KITCHEN_LABEL[order.status] || order.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">
                        {items.length} item{items.length !== 1 ? 's' : ''}
                        {doneCount > 0 && ` · ${doneCount} ready`}
                      </span>
                      <span className="font-bold text-gray-900">{formatCurrency(payable(Number(order.total_amount)))}</span>
                    </div>
                    {pendingRounds.map(([round, roundItems]) => {
                      const key = `${order.id}-${round}`
                      const saving = readyKey === key
                      const confirming = confirmKey === key
                      return (
                        <button
                          key={key}
                          onClick={() => handleMarkReady(order, round, roundItems.map((i) => i.id as string).filter(Boolean))}
                          disabled={saving}
                          className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm text-white disabled:opacity-60 ${
                            confirming ? 'bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-700'
                          }`}
                        >
                          <CheckCircleIcon className="w-5 h-5" />
                          {saving
                            ? 'Saving…'
                            : confirming
                              ? 'Tap again to confirm'
                              : pendingRounds.length > 1 ? `Mark Round ${round} ready` : 'Mark ready'}
                        </button>
                      )
                    })}
                    <button
                      onClick={() => navigate(`/order/add/${order.id}?table=${order.table?.table_number || ''}`)}
                      className="btn-secondary w-full flex items-center justify-center gap-1.5 py-2.5 text-sm"
                      title="Add more items"
                    >
                      <PlusIcon className="w-4 h-4" />
                      Add items
                    </button>
                  </div>
                )
              })}
            </section>
          )}
        </>
      )}

      {/* Inline payment sheet */}
      {payingOrder && (
        <PaymentSheet
          order={payingOrder}
          onClose={() => setPayingOrder(null)}
          onPaid={handlePaid}
        />
      )}
    </div>
  )
}

export default MyOrdersPage
