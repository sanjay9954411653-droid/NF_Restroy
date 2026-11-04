/**
 * ONE bill for the whole app: same data, same maths (computeBill), same look.
 * Used by the Bill screen, every print button, and the totals shown on the
 * Table panel / Order details, so the amount is identical everywhere.
 *
 * The printed bill is self-contained (own CSS, no Tailwind needed), so it
 * can't come out squished because a stylesheet was late.
 */
import api from '../api'
import type { Order, OrderItem } from '../types/order'
import { formatDate } from './utils'
import { formatWeight, ratePerKg } from './weight'
import { calcBill } from './billing'
import { couponApi } from './growthApi'
import { printHtml } from './printHtml'

export interface BillRestaurant {
  name: string
  logo_url: string | null
  gstin: string | null
  fssai_no: string | null
  upi_id: string | null
  address: string | null
  phone: string | null
  tax_rate: number
  tax_inclusive: boolean
  discount_percent: number
  service_charge_percent: number
  other_charges_percent: number
  extra_charges_amount: number
  show_name_in_bill: boolean
  bill_social_keys: string[]
  social_links: Record<string, string>
}

export interface BillCoupon { code: string | null; discount: number }

export interface BillData {
  order: Order
  items: OrderItem[]
  restaurant: BillRestaurant
  tableNumber?: string
  coupon: BillCoupon
}

const SOCIAL_LABELS: Record<string, string> = {
  google_review: 'Google Review',
  facebook: 'Facebook',
  instagram: 'Instagram',
  twitter: 'Twitter / X',
  youtube: 'YouTube',
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n)

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const qrCodeUrl = (data: string, size = 120) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(data)}`

function parseRestaurant(r: any): BillRestaurant {
  return {
    name: r.name,
    logo_url: r.logo_url ?? null,
    gstin: r.gstin ?? null,
    fssai_no: r.fssai_no ?? null,
    upi_id: r.upi_id ?? null,
    address: r.address ?? null,
    phone: r.phone ?? null,
    tax_rate: Number(r.tax_rate ?? 5),
    tax_inclusive: Boolean(r.tax_inclusive),
    discount_percent: Number(r.discount_percent ?? 0),
    service_charge_percent: Number(r.service_charge_percent ?? 0),
    other_charges_percent: Number(r.other_charges_percent ?? 0),
    extra_charges_amount: Number(r.extra_charges_amount ?? 0),
    show_name_in_bill: r.show_name_in_bill !== false,
    bill_social_keys: r.bill_social_keys || [],
    social_links: r.social_links || {},
  }
}

/** Restaurant billing settings + the coupon on an order (what changes the total besides the items). */
export async function loadBillingContext(orderId: string): Promise<{ restaurant: BillRestaurant; coupon: BillCoupon }> {
  const [restRes, couponRes] = await Promise.all([
    api.get('/restaurants/me'),
    couponApi.forOrder(orderId).catch(() => null),
  ])
  return {
    restaurant: parseRestaurant(restRes.data.data),
    coupon: {
      code: couponRes?.data?.data?.code ?? null,
      discount: Number(couponRes?.data?.data?.discount || 0),
    },
  }
}

/** THE one place the bill amounts are calculated. */
export function computeBill({ order, items, restaurant, coupon }: Pick<BillData, 'order' | 'items' | 'restaurant' | 'coupon'>) {
  const rawSubtotal = items.reduce((s, i) => s + Number(i.unit_price || 0) * i.quantity, 0)
  // QR orders can already have a coupon / points discount baked into total_amount.
  const bakedDiscount = items.length ? Math.max(0, rawSubtotal - Number(order.total_amount || 0)) : 0
  return calcBill(rawSubtotal, restaurant, coupon.discount + bakedDiscount)
}

/** Loads everything the bill needs, so any button can print it by order id. */
export async function loadBillData(orderId: string, tableNumber?: string): Promise<BillData> {
  const [orderRes, ctx] = await Promise.all([api.get(`/orders/${orderId}`), loadBillingContext(orderId)])
  const data = orderRes.data.data
  const order: Order = data?.order ?? data
  const items: OrderItem[] = (order as any)?.items || (order as any)?.order_items || data?.items || []
  return {
    order,
    items,
    tableNumber: tableNumber ?? (order?.table?.table_number ? String(order.table.table_number) : undefined),
    ...ctx,
  }
}

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;background:#fff;width:72mm;max-width:100%;margin:0 auto;padding:2mm 1mm}
.c{text-align:center}
.row{display:flex;justify-content:space-between;gap:8px;padding:2px 0}
.row span:first-child{flex:1}
.div{border-top:1px dashed #000;margin:7px 0}
.name{font-size:19px;font-weight:700;margin-top:2px}
.sub{font-size:11px}
.logo{width:50px;height:50px;border-radius:50%;object-fit:cover;display:block;margin:0 auto 3px}
.th{font-size:10px;font-weight:700;text-transform:uppercase;margin-bottom:3px}
.it{margin-bottom:5px}
.it .n{font-weight:700;font-size:13px}
.it .d{font-size:10px;color:#444}
.sm{font-size:11px}
.total{font-size:15px;font-weight:700;border-top:1px solid #000;margin-top:5px;padding-top:5px}
.qr{width:92px;height:92px;display:block;margin:4px auto}
.foot{font-size:11px;margin-top:2px}
@page{size:80mm auto;margin:0}
@media print{body{padding:0 1mm}}
`

export function buildBillBody(data: BillData): string {
  const { order, items, restaurant, tableNumber, coupon } = data
  const b = computeBill(data)
  const isParcel = order.order_type !== 'DINE_IN'
  const social = restaurant.bill_social_keys
    .map((key) => ({ key, url: restaurant.social_links[key], label: SOCIAL_LABELS[key] || key }))
    .filter((s) => !!s.url)
  const review = social.find((s) => s.key === 'google_review')
  const row = (l: string, v: string, cls = '') => `<div class="row ${cls}"><span>${l}</span><span>${v}</span></div>`

  const itemHtml = items
    .map((item) => {
      const unit = Number(item.unit_price || 0)
      const mods = (item.modifiers || [])
        .map((m) => {
          const adj = Number(m.price_adjustment || 0)
          return `${esc(m.modifier_option_name)}${adj > 0 ? ` (+${fmt(adj)})` : adj < 0 ? ` (-${fmt(Math.abs(adj))})` : ''}`
        })
        .join(', ')
      const detail = item.weight_grams
        ? `${esc(formatWeight(item.weight_grams))} × ${fmt(ratePerKg(unit, item.weight_grams))} / kg`
        : `${item.quantity} × ${fmt(unit)}`
      return `<div class="it">
        ${row(`<b class="n">${esc(item.menu_item_name || item.menu_item_id)}</b>`, fmt(unit * item.quantity))}
        ${mods ? `<div class="d">${mods}</div>` : ''}
        <div class="d">${detail}</div>
      </div>`
    })
    .join('')

  return `
    <div class="c">
      ${restaurant.logo_url ? `<img class="logo" src="${esc(restaurant.logo_url)}" alt="">` : ''}
      ${restaurant.show_name_in_bill ? `<div class="name">${esc(restaurant.name)}</div>` : ''}
      ${restaurant.address ? `<div class="sub">${esc(restaurant.address)}</div>` : ''}
      ${restaurant.phone ? `<div class="sub">Ph: ${esc(restaurant.phone)}</div>` : ''}
      ${restaurant.gstin || restaurant.fssai_no ? `<div class="sub">${[restaurant.gstin && `GSTIN: ${esc(restaurant.gstin)}`, restaurant.fssai_no && `FSSAI: ${esc(restaurant.fssai_no)}`].filter(Boolean).join(' • ')}</div>` : ''}
      <div class="sub">${esc(formatDate(order.created_at))}</div>
    </div>
    <div class="div"></div>
    ${row('Order #', `<b>${esc(order.order_number)}</b>`)}
    ${tableNumber ? row('Table', `<b>${esc(tableNumber)}</b>`) : ''}
    ${row('Type', `<b>${esc(order.order_type)}</b>`)}
    <div class="div"></div>
    <div class="row th"><span>Item</span><span>Amount</span></div>
    ${itemHtml}
    <div class="div"></div>
    ${row(`Subtotal${restaurant.tax_inclusive ? ' (incl. GST)' : ''}`, fmt(b.subtotal))}
    ${b.discount > 0 ? row(`Discount (${restaurant.discount_percent}%)`, `-${fmt(b.discount)}`, 'sm') : ''}
    ${b.coupon > 0 ? row(coupon.code ? `Coupon (${esc(coupon.code)})` : 'Coupon / points discount', `-${fmt(b.coupon)}`, 'sm') : ''}
    ${b.serviceCharge > 0 ? row(`Service Charge (${restaurant.service_charge_percent}%)`, fmt(b.serviceCharge), 'sm') : ''}
    ${b.otherCharges > 0 ? row(`Other Charges (${restaurant.other_charges_percent}%)`, fmt(b.otherCharges), 'sm') : ''}
    ${b.extra > 0 ? row('Extra Charges', fmt(b.extra), 'sm') : ''}
    ${restaurant.tax_rate > 0
      ? isParcel
        ? row(`IGST (${restaurant.tax_rate}%)`, fmt(b.cgst + b.sgst), 'sm')
        : row(`CGST (${restaurant.tax_rate / 2}%)`, fmt(b.cgst), 'sm') + row(`SGST (${restaurant.tax_rate / 2}%)`, fmt(b.sgst), 'sm')
      : ''}
    ${row('Grand Total', fmt(b.grandTotal), 'total')}
    ${restaurant.upi_id ? `
      <div class="div"></div>
      <div class="c">
        <img class="qr" src="${qrCodeUrl(`upi://pay?pa=${restaurant.upi_id}&am=${b.grandTotal.toFixed(2)}&cu=INR`)}" alt="">
        <div class="sub">Scan to Pay · ${esc(restaurant.upi_id)}</div>
      </div>` : ''}
    ${review ? `
      <div class="div"></div>
      <div class="c">
        <img class="qr" src="${qrCodeUrl(review.url, 120)}" alt="">
        <div class="sub"><b>Scan to Review us on Google</b></div>
      </div>` : ''}
    ${social.length ? `<div class="c sub" style="margin-top:4px">Follow us: ${social.map((s) => esc(s.label)).join(' · ')}</div>` : ''}
    <div class="div"></div>
    <div class="c foot">
      <div>Thank you for dining with us!</div>
      ${restaurant.gstin ? '<div>This is a computer generated bill</div>' : ''}
    </div>`
}

export function buildBillDocument(data: BillData): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bill ${esc(data.order.order_number)}</title><style>${CSS}</style></head><body>${buildBillBody(data)}</body></html>`
}

/** Print the standard bill for any order id. Used by every "Print Bill / Receipt" button. */
export async function printBill(orderId: string, tableNumber?: string): Promise<void> {
  const data = await loadBillData(orderId, tableNumber)
  await printHtml(buildBillDocument(data))
}
