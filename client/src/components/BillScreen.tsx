/**
 * BillScreen — shown when a READY order is tapped.
 *
 * Displays a formatted bill with:
 *   - Restaurant name + GSTIN
 *   - Order number, table, date/time
 *   - Itemized list
 *   - Subtotal + CGST + SGST (or IGST for parcel/online) + Grand Total
 *
 * Two actions:
 *   [Print Bill]       — opens browser print dialog (thermal-friendly layout)
 *   [Collect Payment]  — opens the PaymentForm with grand total pre-filled
 */

import React, { useEffect, useState, useRef } from 'react'
import api, { getErrorMessage } from '../api'
import toast from 'react-hot-toast'
import { Order, OrderItem } from '../types/order'
import { formatDate } from '../lib/utils'
import { formatWeight, ratePerKg } from '../lib/weight'
import Button from './Button'
import Loading from './Loading'
import PaymentForm from './PaymentForm'
import { PrinterIcon, CurrencyDollarIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { calcBill } from '../lib/billing'
import { couponApi } from '../lib/growthApi'
import { printHtml } from '../lib/printHtml'
import { buildBillDocument } from '../lib/billPrint'

interface RestaurantInfo {
  name: string
  logo_url: string | null
  gstin: string | null
  fssai_no: string | null
  upi_id: string | null
  address: string | null
  phone: string | null
  tax_rate: number
  tax_inclusive: boolean
  qsr_enabled: boolean
  token_prefix: string
  discount_percent: number
  service_charge_percent: number
  other_charges_percent: number
  extra_charges_amount: number
  show_name_in_bill: boolean
  bill_social_keys: string[]
  social_links: Record<string, string>
}

const SOCIAL_LABELS: Record<string, string> = {
  google_review: 'Google Review',
  facebook: 'Facebook',
  instagram: 'Instagram',
  twitter: 'Twitter / X',
  youtube: 'YouTube',
}

/** Small inline QR code image via a public generator — no extra deps needed. */
const qrCodeUrl = (data: string, size = 120) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(data)}`

interface BillScreenProps {
  orderId: string
  tableNumber?: string
  onClose: () => void
  onCompleted: () => void
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n)

const BillScreen: React.FC<BillScreenProps> = ({ orderId, tableNumber, onClose, onCompleted }) => {
  const printRef = useRef<HTMLDivElement>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [coupon, setCoupon] = useState<{ code: string | null; discount: number }>({ code: null, discount: 0 })
  const [couponInput, setCouponInput] = useState('')
  const [couponBusy, setCouponBusy] = useState(false)

  const loadCoupon = () =>
    couponApi
      .forOrder(orderId)
      .then((res) => setCoupon({ code: res.data.data?.code ?? null, discount: Number(res.data.data?.discount || 0) }))
      .catch(() => {})

  useEffect(() => { loadCoupon() }, [orderId])

  const applyCoupon = async () => {
    const code = couponInput.trim()
    if (!code) return
    setCouponBusy(true)
    try {
      const res = await couponApi.applyToOrder(orderId, code)
      setCoupon({ code: res.data.data.code, discount: Number(res.data.data.discount || 0) })
      setCouponInput('')
      toast.success('Coupon applied')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setCouponBusy(false)
    }
  }

  const removeCoupon = async () => {
    setCouponBusy(true)
    try {
      await couponApi.removeFromOrder(orderId)
      setCoupon({ code: null, discount: 0 })
      toast.success('Coupon removed')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setCouponBusy(false)
    }
  }

  useEffect(() => {
    Promise.all([
      api.get(`/orders/${orderId}`),
      api.get('/restaurants/me'),
    ])
      .then(([orderRes, restRes]) => {
        const data = orderRes.data.data
        const ord = data?.order ?? data
        setOrder(ord)
        setItems(ord?.items || ord?.order_items || data?.items || [])

        const r = restRes.data.data
        setRestaurant({
          name: r.name,
          logo_url: r.logo_url ?? null,
          gstin: r.gstin ?? null,
          fssai_no: r.fssai_no ?? null,
          upi_id: r.upi_id ?? null,
          address: r.address ?? null,
          phone: r.phone ?? null,
          tax_rate: Number(r.tax_rate ?? 5),
          tax_inclusive: Boolean(r.tax_inclusive),
          qsr_enabled: Boolean(r.qsr_enabled),
          token_prefix: r.token_prefix || 'T',
          discount_percent: Number(r.discount_percent ?? 0),
          service_charge_percent: Number(r.service_charge_percent ?? 0),
          other_charges_percent: Number(r.other_charges_percent ?? 0),
          extra_charges_amount: Number(r.extra_charges_amount ?? 0),
          show_name_in_bill: r.show_name_in_bill !== false,
          bill_social_keys: r.bill_social_keys || [],
          social_links: r.social_links || {},
        })
      })
      .catch((err) => toast.error(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [orderId])

  const handlePrint = () => {
    if (!order || !restaurant) return
    printHtml(buildBillDocument({ order, items, restaurant, tableNumber, coupon }))
  }

  if (loading) return (
    <div className="fixed inset-0 z-50 bg-white flex items-center justify-center">
      <Loading text="Loading bill…" />
    </div>
  )

  if (!order || !restaurant) return null

  const rawSubtotal = items.reduce((s, i) => s + Number(i.unit_price || 0) * i.quantity, 0)
  // QR orders can already have a coupon / points discount baked into total_amount.
  const bakedDiscount = items.length ? Math.max(0, rawSubtotal - Number(order.total_amount || 0)) : 0
  const { subtotal, discount, coupon: couponAmount, serviceCharge, otherCharges, extra, cgst, sgst, grandTotal } = calcBill(rawSubtotal, restaurant, coupon.discount + bakedDiscount)
  const isParcel = order.order_type !== 'DINE_IN'
  const visibleSocialLinks = restaurant.bill_social_keys
    .map((key) => ({ key, url: restaurant.social_links[key], label: SOCIAL_LABELS[key] || key }))
    .filter((s) => !!s.url)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pb-3 header-safe border-b border-gray-200 shrink-0">
        <h2 className="font-bold text-gray-900 text-lg">Bill</h2>
        <button type="button" title="Close" onClick={onClose} className="p-2 rounded-full hover:bg-gray-100">
          <XMarkIcon className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      {/* Scrollable bill area */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
        {/* Printable content */}
        <div
          ref={printRef}
          className="max-w-sm mx-auto space-y-3 text-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-5"
        >
          {/* Restaurant header */}
          <div className="text-center space-y-0.5">
            {restaurant.logo_url && (
              <img
                src={restaurant.logo_url}
                alt=""
                className="h-14 w-14 rounded-full object-cover mx-auto mb-1.5 ring-1 ring-gray-100"
              />
            )}
            {restaurant.show_name_in_bill && (
              <p className="text-xl font-bold text-gray-900 tracking-tight">{restaurant.name}</p>
            )}
            {restaurant.address && (
              <p className="text-xs text-gray-500">{restaurant.address}</p>
            )}
            {restaurant.phone && (
              <p className="text-xs text-gray-500">Ph: {restaurant.phone}</p>
            )}
            <div className="flex items-center justify-center gap-2 flex-wrap pt-0.5">
              {restaurant.gstin && (
                <span className="text-[11px] text-gray-500">GSTIN: {restaurant.gstin}</span>
              )}
              {restaurant.gstin && restaurant.fssai_no && <span className="text-[11px] text-gray-300">•</span>}
              {restaurant.fssai_no && (
                <span className="text-[11px] text-gray-500">FSSAI: {restaurant.fssai_no}</span>
              )}
            </div>
            <p className="text-xs text-gray-400">{formatDate(order.created_at)}</p>
          </div>

          <div className="border-t border-dashed border-gray-300" />

          {/* Order info */}
          <div className="space-y-1 text-xs text-gray-600">
            <div className="flex justify-between">
              <span>Order #</span>
              <span className="font-medium text-gray-900">{order.order_number}</span>
            </div>
            {tableNumber && (
              <div className="flex justify-between">
                <span>Table</span>
                <span className="font-medium text-gray-900">{tableNumber}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Type</span>
              <span className="font-medium text-gray-900">{order.order_type}</span>
            </div>
          </div>

          <div className="border-t border-dashed border-gray-300" />

          {/* Items */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold text-gray-500 uppercase">
              <span>Item</span>
              <span>Amount</span>
            </div>
            {items.map((item, i) => {
              const lineTotal = Number(item.unit_price || 0) * item.quantity
              return (
                <div key={item.id || i}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-900 flex-1 pr-2">
                      {item.menu_item_name || item.menu_item_id}
                    </span>
                    <span className="text-gray-900 shrink-0">{fmt(lineTotal)}</span>
                  </div>
                  {item.modifiers && item.modifiers.length > 0 && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      {item.modifiers.map((m, mi) => {
                        const adj = Number(m.price_adjustment || 0)
                        return (
                          <span key={mi}>
                            {mi > 0 && ', '}
                            {m.modifier_option_name}
                            {adj > 0 ? ` (+${fmt(adj)})` : adj < 0 ? ` (-${fmt(Math.abs(adj))})` : ''}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  <div className="text-xs text-gray-400">
                    {item.weight_grams
                      ? `${formatWeight(item.weight_grams)} × ${fmt(ratePerKg(Number(item.unit_price || 0), item.weight_grams))} / kg`
                      : `${item.quantity} × ${fmt(Number(item.unit_price || 0))}`}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="border-t border-dashed border-gray-300" />

          {/* Tax breakdown */}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal{restaurant.tax_inclusive ? ' (incl. GST)' : ''}</span>
              <span>{fmt(subtotal)}</span>
            </div>

            {discount > 0 && (
              <div className="flex justify-between text-emerald-600 text-xs">
                <span>Discount ({restaurant.discount_percent}%)</span>
                <span>-{fmt(discount)}</span>
              </div>
            )}
            {couponAmount > 0 && (
              <div className="flex justify-between text-emerald-600 text-xs">
                <span>{coupon.code ? `Coupon (${coupon.code})` : 'Coupon / points discount'}</span>
                <span>-{fmt(couponAmount)}</span>
              </div>
            )}
            {serviceCharge > 0 && (
              <div className="flex justify-between text-gray-500 text-xs">
                <span>Service Charge ({restaurant.service_charge_percent}%)</span>
                <span>{fmt(serviceCharge)}</span>
              </div>
            )}
            {otherCharges > 0 && (
              <div className="flex justify-between text-gray-500 text-xs">
                <span>Other Charges ({restaurant.other_charges_percent}%)</span>
                <span>{fmt(otherCharges)}</span>
              </div>
            )}
            {extra > 0 && (
              <div className="flex justify-between text-gray-500 text-xs">
                <span>Extra Charges</span>
                <span>{fmt(extra)}</span>
              </div>
            )}

            {restaurant.tax_rate > 0 && (
              <>
                {isParcel ? (
                  <div className="flex justify-between text-gray-500 text-xs">
                    <span>IGST ({restaurant.tax_rate}%)</span>
                    <span>{fmt(cgst + sgst)}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-gray-500 text-xs">
                      <span>CGST ({restaurant.tax_rate / 2}%)</span>
                      <span>{fmt(cgst)}</span>
                    </div>
                    <div className="flex justify-between text-gray-500 text-xs">
                      <span>SGST ({restaurant.tax_rate / 2}%)</span>
                      <span>{fmt(sgst)}</span>
                    </div>
                  </>
                )}
              </>
            )}

            <div className="border-t border-gray-200 pt-2 flex justify-between font-bold text-base text-gray-900">
              <span>Grand Total</span>
              <span className="text-indigo-600">{fmt(grandTotal)}</span>
            </div>
          </div>

          {/* UPI payment QR */}
          {restaurant.upi_id && (
            <>
              <div className="border-t border-dashed border-gray-300" />
              <div className="text-center py-1">
                <img
                  src={qrCodeUrl(`upi://pay?pa=${restaurant.upi_id}&am=${grandTotal.toFixed(2)}&cu=INR`)}
                  alt="Scan to pay via UPI"
                  className="w-24 h-24 mx-auto"
                />
                <p className="text-xs text-gray-500 mt-1">Scan to Pay · {restaurant.upi_id}</p>
              </div>
            </>
          )}

          {/* Google Review QR + social links */}
          {visibleSocialLinks.some((s) => s.key === 'google_review') && (
            <>
              <div className="border-t border-dashed border-gray-300" />
              <div className="text-center py-1">
                <img
                  src={qrCodeUrl(visibleSocialLinks.find((s) => s.key === 'google_review')!.url, 120)}
                  alt="Scan to leave a Google Review"
                  className="w-24 h-24 mx-auto"
                />
                <p className="text-xs font-medium text-gray-700 mt-1">Scan to Review us on Google</p>
              </div>
            </>
          )}

          {visibleSocialLinks.length > 0 && (
            <div className="text-center text-[11px] text-gray-400 space-y-0.5">
              <p>Follow us:</p>
              <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
                {visibleSocialLinks.map((s, i) => (
                  <span key={s.key}>
                    {i > 0 && ' · '}
                    <a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.label}</a>
                  </span>
                ))}
              </p>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-dashed border-gray-300 pt-2 text-center text-xs text-gray-400">
            <p>Thank you for dining with us!</p>
            {restaurant.gstin && <p className="mt-0.5">This is a computer generated bill</p>}
          </div>
        </div>
      </div>

      {/* Staff coupon (not part of the printed bill) */}
      <div className="px-4 pt-3 border-t border-gray-200 shrink-0">
        {coupon.code ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-emerald-700 font-medium">Coupon {coupon.code} applied</span>
            <button type="button" disabled={couponBusy} onClick={removeCoupon} className="text-red-600 text-xs font-medium px-2 py-1">
              Remove
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') applyCoupon() }}
              placeholder="Coupon code"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <Button variant="outline" onClick={applyCoupon} disabled={couponBusy || !couponInput.trim()}>
              Apply
            </Button>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 pt-4 footer-safe border-t border-gray-200 grid grid-cols-2 gap-3 shrink-0">
        <Button
          variant="outline"
          fullWidth
          leftIcon={<PrinterIcon className="w-4 h-4" />}
          onClick={handlePrint}
        >
          Print Bill
        </Button>
        <Button
          variant="primary"
          fullWidth
          leftIcon={<CurrencyDollarIcon className="w-4 h-4" />}
          onClick={() => setPaymentOpen(true)}
        >
          Collect Payment
        </Button>
      </div>

      {/* Payment form */}
      {paymentOpen && (
        <PaymentForm
          orderId={orderId}
          onClose={() => setPaymentOpen(false)}
          onPaymentSuccess={() => {
            setPaymentOpen(false)
            toast.success('Payment recorded ✓')
            onCompleted()
          }}
        />
      )}
    </div>
  )
}

export default BillScreen
