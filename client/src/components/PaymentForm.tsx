import React, { useState, useEffect } from 'react'
import api, { getErrorMessage } from '../api'
import { Payment, PaymentStatus, PaymentMethod } from '../types/payment'
import { Order } from '../types/order'
import Modal from './Modal'
import Button from './Button'
import Input from './Input'
import { formatCurrency } from '../lib/utils'
import { calcBill } from '../lib/billing'
import { usePayable } from '../lib/useBillTotal'
import toast from 'react-hot-toast'

const METHODS: PaymentMethod[] = ['CASH', 'CARD', 'UPI', 'ONLINE']
const STATUSES: PaymentStatus[] = ['PENDING', 'PAID', 'REFUNDED']

interface PaymentFormProps {
  orderId: string
  onClose: () => void
  onPaymentSuccess: (payment: Payment) => void
}

interface SplitPayment {
  id: number
  method: PaymentMethod
  amount: number
  reference: string
}

const PaymentForm: React.FC<PaymentFormProps> = ({
  orderId: initialOrderId,
  onClose,
  onPaymentSuccess,
}) => {
  const payable = usePayable()
  const [orders, setOrders] = useState<Order[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState(initialOrderId)

  const [orderTotal, setOrderTotal] = useState(0)
  const [totalLoaded, setTotalLoaded] = useState(false)
  const [alreadyPaid, setAlreadyPaid] = useState(0)

  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [status, setStatus] = useState<PaymentStatus>('PAID')
  const [reference, setReference] = useState('')

  const [splitMode, setSplitMode] = useState(false)
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([])

  const [saving, setSaving] = useState(false)
  const [_loadingOrders, setLoadingOrders] = useState(!initialOrderId)

  useEffect(() => {
    if (!initialOrderId) {
      api.get('/orders', { params: { limit: 100 } })
        .then((res) => {
          const active = (res.data.data?.items || []).filter(
            (o: Order) =>
              !['COMPLETED', 'CANCELLED'].includes(o.status)
          )

          setOrders(active)
        })
        .catch((err) => toast.error(getErrorMessage(err)))
        .finally(() => setLoadingOrders(false))
    }
  }, [initialOrderId])

  useEffect(() => {
    if (!selectedOrderId) return

    let cancelled = false

    setTotalLoaded(false)

    Promise.all([
      api.get(`/orders/${selectedOrderId}`),
      api.get('/payments', { params: { limit: 500 } }),
      api.get('/restaurants/me'),
      // Coupon staff applied on the Bill screen (older backend: no coupon)
      api.get(`/coupons/order/${selectedOrderId}`).catch(() => null),
    ])
      .then(([orderRes, paymentsRes, restRes, couponRes]) => {
        if (cancelled) return

        const data = orderRes.data.data
        const ord = data?.order ?? data
        const orderItems: any[] =
          ord?.items || ord?.order_items || data?.items || []

        // Same calculation as the Bill screen: item subtotal + discount,
        // service/other charges and GST = the grand total the customer pays.
        const rawSubtotal = orderItems.length
          ? orderItems.reduce(
              (sum, i) => sum + Number(i.unit_price || 0) * Number(i.quantity || 0),
              0
            )
          : Number(ord?.total_amount || 0)

        // Discount already baked into total_amount (QR coupon / points)
        const baked = orderItems.length
          ? Math.max(0, rawSubtotal - Number(ord?.total_amount || 0))
          : 0

        const r = restRes.data.data || {}
        const grand = calcBill(rawSubtotal, {
          tax_rate: Number(r.tax_rate ?? 5),
          tax_inclusive: Boolean(r.tax_inclusive),
          discount_percent: Number(r.discount_percent ?? 0),
          service_charge_percent: Number(r.service_charge_percent ?? 0),
          other_charges_percent: Number(r.other_charges_percent ?? 0),
          extra_charges_amount: Number(r.extra_charges_amount ?? 0),
        }, Number(couponRes?.data?.data?.discount || 0) + baked).grandTotal

        const total = Math.round(grand * 100) / 100

        const allPayments: Payment[] =
          paymentsRes.data.data?.items || []

        const paid = allPayments
          .filter(
            (p) =>
              p.order_id === selectedOrderId &&
              p.status === 'PAID'
          )
          .reduce(
            (sum, p) => sum + Number(p.amount),
            0
          )

        setOrderTotal(total)
        setAlreadyPaid(paid)
        setTotalLoaded(true)

        const remaining = Math.max(0, total - paid)

        setAmount(remaining)
      })
      .catch((err) => toast.error(getErrorMessage(err)))

    return () => {
      cancelled = true
    }
  }, [selectedOrderId])

  const balance = Math.max(
    0,
    orderTotal - alreadyPaid
  )

  const isFullyPaid =
    orderTotal > 0 &&
    alreadyPaid >= orderTotal

  const splitTotal = splitPayments.reduce(
    (sum, payment) =>
      sum + (Number(payment.amount) || 0),
    0
  )

  const splitRemaining = Math.max(
    0,
    balance - splitTotal
  )

  const splitOverpaid = Math.max(
    0,
    splitTotal - balance
  )

  const startSplitPayment = () => {
    setSplitPayments([
      {
        id: 1,
        method: 'CASH',
        amount: balance,
        reference: '',
      },
    ])

    setSplitMode(true)
  }

  const addSplitPayment = () => {
    const newId =
      splitPayments.length > 0
        ? Math.max(
            ...splitPayments.map(
              (payment) => payment.id
            )
          ) + 1
        : 1

    setSplitPayments((current) => [
      ...current,
      {
        id: newId,
        method: 'UPI',
        amount: 0,
        reference: '',
      },
    ])
  }

  const updateSplitPayment = (
    id: number,
    field: keyof SplitPayment,
    value: string | number
  ) => {
    setSplitPayments((current) => {
      const next = current.map((payment) =>
        payment.id === id
          ? {
              ...payment,
              [field]: value,
            }
          : payment
      )
      // Autofill: when an amount is typed on any line except the last, the last
      // line takes whatever is still left to collect.
      const last = next[next.length - 1]
      if (field === 'amount' && next.length > 1 && last.id !== id) {
        const others = next
          .slice(0, -1)
          .reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
        next[next.length - 1] = { ...last, amount: Math.max(0, Math.round((balance - others) * 100) / 100) }
      }
      return next
    })
  }

  const removeSplitPayment = (id: number) => {
    if (splitPayments.length <= 1) {
      toast.error(
        'At least one payment is required'
      )
      return
    }

    setSplitPayments((current) =>
      current.filter(
        (payment) => payment.id !== id
      )
    )
  }

  const handleSinglePayment = async () => {
    if (amount <= 0) {
      throw new Error(
        'Amount must be greater than 0'
      )
    }

    if (amount > balance) {
      throw new Error(
        'Payment cannot exceed the remaining balance'
      )
    }

    const res = await api.post('/payments', {
      order_id: selectedOrderId,
      amount,
      method,
      status,
      reference_number:
        reference.trim() || undefined,
    })

    const payment = res.data.data

    const newPaid =
      alreadyPaid + amount

    if (
      status === 'PAID' &&
      newPaid >= orderTotal &&
      orderTotal > 0
    ) {
      try {
        await api.patch(
          `/orders/${selectedOrderId}`,
          {
            status: 'COMPLETED',
          }
        )
      } catch {
        // Backend may already have completed it
      }
    }

    onPaymentSuccess(payment)
  }
    const handleSplitPayment = async () => {
    const validPayments =
      splitPayments.filter(
        (payment) =>
          Number(payment.amount) > 0
      )

    if (validPayments.length === 0) {
      throw new Error(
        'Enter at least one payment amount'
      )
    }

    if (splitOverpaid > 0) {
      throw new Error(
        `Part payment exceeds balance by ${formatCurrency(
          splitOverpaid
        )}`
      )
    }

    if (splitRemaining > 0) {
      throw new Error(
        `Remaining balance: ${formatCurrency(
          splitRemaining
        )}`
      )
    }

    let lastPayment: Payment | null = null

    for (const payment of validPayments) {
      const res = await api.post(
        '/payments',
        {
          order_id: selectedOrderId,
          amount: Number(payment.amount),
          method: payment.method,
          status: 'PAID',
          reference_number:
            payment.reference.trim() ||
            undefined,
        }
      )

      lastPayment = res.data.data
    }

    try {
      await api.patch(
        `/orders/${selectedOrderId}`,
        {
          status: 'COMPLETED',
        }
      )
    } catch {
      // Backend may already have completed it
    }

    if (lastPayment) {
      onPaymentSuccess(lastPayment)
    }

    toast.success(
      'Part payment completed successfully'
    )
  }

  const handleSubmit = async (
    e: React.FormEvent
  ) => {
    e.preventDefault()

    if (!selectedOrderId) {
      toast.error(
        'Please select an order'
      )
      return
    }

    if (isFullyPaid) {
      toast.error(
        'This order is already fully paid'
      )
      return
    }

    setSaving(true)

    try {
      if (splitMode) {
        await handleSplitPayment()
      } else {
        await handleSinglePayment()
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : getErrorMessage(err)
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={
        splitMode
          ? 'Part Payment'
          : 'Record Payment'
      }
      size="sm"
      footer={
        <div className="flex gap-3">
          <Button
            type="submit"
            form="payment-form"
            variant="primary"
            fullWidth
            isLoading={saving}
            disabled={
              !totalLoaded ||
              isFullyPaid ||
              (splitMode &&
                (splitRemaining > 0 ||
                  splitOverpaid > 0))
            }
          >
            {splitMode
              ? 'Complete Part Payment'
              : 'Record Payment'}
          </Button>

          <Button
            variant="outline"
            fullWidth
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      }
    >
      <form
        id="payment-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        {!initialOrderId ? (
          <div>
            <label className="form-label">
              Order{' '}
              <span className="text-red-500">
                *
              </span>
            </label>

            <select
              value={selectedOrderId}
              onChange={(e) =>
                setSelectedOrderId(
                  e.target.value
                )
              }
              className="form-select w-full"
              required
            >
              <option value="">
                Select an order…
              </option>

              {orders.map((o) => (
                <option
                  key={o.id}
                  value={o.id}
                >
                  {o.order_number} —{' '}
                  {formatCurrency(payable(Number(o.total_amount)))}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600 border border-slate-200">
            <div className="flex justify-between">
              <span>
                Order total
              </span>

              <span className="font-semibold text-slate-900">
                {totalLoaded
                  ? formatCurrency(orderTotal)
                  : '…'}
              </span>
            </div>

            {alreadyPaid > 0 && (
              <div className="flex justify-between mt-1 text-emerald-700">
                <span>
                  Already paid
                </span>

                <span className="font-semibold">
                  −{' '}
                  {formatCurrency(
                    alreadyPaid
                  )}
                </span>
              </div>
            )}

            {orderTotal > 0 && (
              <div className="flex justify-between mt-1 pt-1 border-t border-slate-200 font-semibold">
                <span
                  className={
                    balance === 0
                      ? 'text-emerald-700'
                      : 'text-slate-900'
                  }
                >
                  {balance === 0
                    ? '✓ Fully paid'
                    : 'Balance due'}
                </span>

                <span
                  className={
                    balance === 0
                      ? 'text-emerald-700'
                      : 'text-slate-900'
                  }
                >
                  {formatCurrency(
                    balance
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {isFullyPaid ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
            <p className="text-emerald-700 font-semibold text-sm">
              ✓ This order is already fully paid
            </p>

            <p className="text-emerald-600 text-xs mt-1">
              No further payment is needed.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() =>
                  setSplitMode(false)
                }
                className={`py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  !splitMode
                    ? 'bg-white text-brand-600 shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                Single Payment
              </button>

              <button
                type="button"
                onClick={
                  startSplitPayment
                }
                className={`py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  splitMode
                    ? 'bg-white text-brand-600 shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                Part Payment
              </button>
            </div>

            {!splitMode ? (
              <>
                <Input
                  label={`Amount${
                    balance > 0
                      ? ` (balance: ${formatCurrency(
                          balance
                        )})`
                      : ''
                  }`}
                  type="number"
                  step="0.01"
                  min={0.01}
                  max={
                    balance > 0
                      ? balance
                      : undefined
                  }
                  value={
                    amount || ''
                  }
                  onChange={(e) =>
                    setAmount(
                      parseFloat(
                        e.target.value
                      ) || 0
                    )
                  }
                  leftIcon={
                    <span className="text-slate-400 text-sm">
                      ₹
                    </span>
                  }
                  required
                  fullWidth
                />

                <div>
                  <label className="form-label">
                    Payment Method
                  </label>

                  <div className="grid grid-cols-4 gap-2">
                    {METHODS.map(
                      (m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() =>
                            setMethod(
                              m
                            )
                          }
                          className={`py-2 text-xs font-medium rounded-lg border transition-colors ${
                            method === m
                              ? 'bg-brand-600 text-white border-brand-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300'
                          }`}
                        >
                          {m}
                        </button>
                      )
                    )}
                  </div>
                </div>

                <div>
                  <label className="form-label">
                    Status
                  </label>

                  <div className="grid grid-cols-3 gap-2">
                    {STATUSES.map(
                      (s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() =>
                            setStatus(
                              s
                            )
                          }
                          className={`py-2 text-xs font-medium rounded-lg border transition-colors ${
                            status === s
                              ? 'bg-brand-600 text-white border-brand-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300'
                          }`}
                        >
                          {s}
                        </button>
                      )
                    )}
                  </div>
                </div>

                {(method === 'CARD' ||
                  method === 'UPI' ||
                  method ===
                    'ONLINE') && (
                  <Input
                    label="Reference / Transaction ID (optional)"
                    placeholder="e.g. TXN123456"
                    value={
                      reference
                    }
                    onChange={(e) =>
                      setReference(
                        e.target.value
                      )
                    }
                    fullWidth
                  />
                )}
              </>
            ) : (
              <>
                                <div className="bg-slate-50 rounded-xl border border-slate-200 p-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">
                      Balance to pay
                    </span>

                    <span className="font-bold text-slate-900">
                      {formatCurrency(
                        balance
                      )}
                    </span>
                  </div>

                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-slate-600">
                      Part total
                    </span>

                    <span className="font-semibold">
                      {formatCurrency(
                        splitTotal
                      )}
                    </span>
                  </div>

                  <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between">
                    <span
                      className={
                        splitOverpaid > 0
                          ? 'text-red-600 font-semibold'
                          : splitRemaining > 0
                          ? 'text-orange-600 font-semibold'
                          : 'text-emerald-700 font-semibold'
                      }
                    >
                      {splitOverpaid > 0
                        ? 'Overpayment'
                        : splitRemaining > 0
                        ? 'Remaining'
                        : '✓ Ready to pay'}
                    </span>

                    <span
                      className={
                        splitOverpaid > 0
                          ? 'text-red-600 font-bold'
                          : splitRemaining > 0
                          ? 'text-orange-600 font-bold'
                          : 'text-emerald-700 font-bold'
                      }
                    >
                      {formatCurrency(
                        splitOverpaid > 0
                          ? splitOverpaid
                          : splitRemaining
                      )}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {splitPayments.map(
                    (
                      payment,
                      index
                    ) => (
                      <div
                        key={
                          payment.id
                        }
                        className="border border-slate-200 rounded-xl p-3 bg-white"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-semibold text-slate-700">
                            Payment{' '}
                            {index +
                              1}
                          </span>

                          {splitPayments.length >
                            1 && (
                            <button
                              type="button"
                              onClick={() =>
                                removeSplitPayment(
                                  payment.id
                                )
                              }
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              Remove
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          {METHODS.map(
                            (m) => (
                              <button
                                key={
                                  m
                                }
                                type="button"
                                onClick={() =>
                                  updateSplitPayment(
                                    payment.id,
                                    'method',
                                    m
                                  )
                                }
                                className={`py-2 text-xs font-medium rounded-lg border transition-colors ${
                                  payment.method ===
                                  m
                                    ? 'bg-brand-600 text-white border-brand-600'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300'
                                }`}
                              >
                                {m}
                              </button>
                            )
                          )}
                        </div>

                        <div className="mt-3">
                          <Input
                            label="Amount"
                            type="number"
                            step="0.01"
                            min={0}
                            value={
                              payment.amount ||
                              ''
                            }
                            onChange={(e) =>
                              updateSplitPayment(
                                payment.id,
                                'amount',
                                parseFloat(
                                  e.target.value
                                ) || 0
                              )
                            }
                            leftIcon={
                              <span className="text-slate-400 text-sm">
                                ₹
                              </span>
                            }
                            fullWidth
                          />
                        </div>

                        {(payment.method ===
                          'CARD' ||
                          payment.method ===
                            'UPI' ||
                          payment.method ===
                            'ONLINE') && (
                          <div className="mt-3">
                            <Input
                              label="Reference / Transaction ID (optional)"
                              placeholder="e.g. TXN123456"
                              value={
                                payment.reference
                              }
                              onChange={(
                                e
                              ) =>
                                updateSplitPayment(
                                  payment.id,
                                  'reference',
                                  e.target
                                    .value
                                )
                              }
                              fullWidth
                            />
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>

                <button
                  type="button"
                  onClick={
                    addSplitPayment
                  }
                  className="w-full py-2.5 rounded-xl border border-dashed border-brand-300 text-brand-600 text-sm font-semibold hover:bg-brand-50 transition-colors"
                >
                  + Add Payment
                </button>

                {splitRemaining ===
                  0 &&
                  splitOverpaid ===
                    0 && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                      <p className="text-emerald-700 font-semibold text-sm">
                        ✓ Part payment
                        is ready
                      </p>

                      <p className="text-emerald-600 text-xs mt-1">
                        Total payments
                        equal the
                        remaining
                        balance.
                      </p>
                    </div>
                  )}

                {splitOverpaid >
                  0 && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                    <p className="text-red-700 font-semibold text-sm">
                      Payment amount
                      is too high
                    </p>

                    <p className="text-red-600 text-xs mt-1">
                      Reduce the
                      part amount
                      by{' '}
                      {formatCurrency(
                        splitOverpaid
                      )}
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </form>
    </Modal>
  )
}

export default PaymentForm
