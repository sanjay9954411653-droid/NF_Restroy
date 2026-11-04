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
import toast from 'react-hot-toast'
import { printHtml } from './printHtml'
import {
  ascii, bytes, ESC, GS,
  getConnectedPrinter, printRaw, silentReconnectUSB, silentReconnectBluetooth,
} from './thermalPrinter'

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
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;background:#fff;width:80mm;margin:0 auto;padding:6px 8px}
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
@page{size:80mm auto;margin:3mm}
@media print{body{padding:0}}
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

// ── Direct thermal (ESC/POS) bill ────────────────────────────────────────────
// Used when a USB / Bluetooth receipt printer is connected, so "Print Bill" prints
// straight away instead of opening the phone's print dialog (which only offers PDF).

const PAPER_KEY = 'bill_paper_width'
export type PaperWidth = 58 | 80

/** 58 mm is the common phone / OTG printer size; 80 mm is the larger counter printer. */
export function getBillPaperWidth(): PaperWidth {
  try { return localStorage.getItem(PAPER_KEY) === '80' ? 80 : 58 } catch { return 58 }
}
export function setBillPaperWidth(w: PaperWidth): void {
  try { localStorage.setItem(PAPER_KEY, String(w)) } catch { /* ignore */ }
}

const money = (n: number) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function logoToPrinterBytes(url: string, maxWidth = 384): Promise<number[]> {
  const img = new Image()
  img.crossOrigin = 'anonymous'

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Could not load restaurant logo'))
    img.src = url
  })

  const scale = Math.min(1, maxWidth / img.width)
  const width = Math.max(1, Math.floor(img.width * scale))
  const height = Math.max(1, Math.floor(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process logo')

  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)

  const pixels = ctx.getImageData(0, 0, width, height).data
  const rowBytes = Math.ceil(width / 8)
  const raster: number[] = []

  for (let y = 0; y < height; y++) {
    for (let bx = 0; bx < rowBytes; bx++) {
      let value = 0
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + bit
        if (x < width) {
          const i = (y * width + x) * 4
          const gray = (
            pixels[i] * 0.299 +
            pixels[i + 1] * 0.587 +
            pixels[i + 2] * 0.114
          )
          if (gray < 160) value |= 0x80 >> bit
        }
      }
      raster.push(value)
    }
  }

  return [
    0x1d, 0x76, 0x30, 0,
    rowBytes & 0xff, (rowBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
    ...raster,
    0x0a,
  ]
}


/** Builds the raw ESC/POS bytes for a bill. `cols` = characters per line (32 for 58 mm, 42 for 80 mm). */
export async function buildBillBytes(
  data: BillData,
  cols: number = getBillPaperWidth() === 80 ? 42 : 32,
): Promise<Uint8Array> {
  const { order, items, restaurant, tableNumber, coupon } = data
  const b = computeBill(data)
  const isParcel = order.order_type !== 'DINE_IN'
  const W = cols
  const out: number[] = []

  const push = (...p: Array<number | string | number[]>) => {
    out.push(...bytes(...p))
  }
  const align = (n: 0 | 1) => push(ESC, 0x61, n)
  const bold = (on: boolean) => push(ESC, 0x45, on ? 1 : 0)
  const textSize = (n: number) => push(GS, 0x21, n)
  const wrap = (text: string, width: number): string[] => {
    const t = ascii(text).replace(/\s+/g, ' ').trim()
    if (!t) return []
    const lines: string[] = []
    let current = ''

    for (const word of t.split(' ')) {
      if (word.length > width) {
        if (current) {
          lines.push(current)
          current = ''
        }
        for (let i = 0; i < word.length; i += width) {
          lines.push(word.slice(i, i + width))
        }
      } else if ((current ? current.length + 1 : 0) + word.length > width) {
        if (current) lines.push(current)
        current = word
      } else {
        current = current ? `${current} ${word}` : word
      }
    }

    if (current) lines.push(current)
    return lines
  }
  const center = (text: string) => {
    align(1)
    wrap(text, W).forEach((line) => push(line + '\n'))
    align(0)
  }
  const left = (text: string) => {
    wrap(text, W).forEach((line) => push(line + '\n'))
  }
  const lr = (label: string, value: string) => {
    const right = ascii(value)
    const available = Math.max(1, W - right.length - 1)
    const labelLines = wrap(label, available)
    if (labelLines.length > 1) {
      labelLines.slice(0, -1).forEach((line) => push(line + '\n'))
    }
    const finalLabel = (labelLines[labelLines.length - 1] || '').slice(0, available)
    push(
      finalLabel +
      ' '.repeat(Math.max(1, W - finalLabel.length - right.length)) +
      right +
      '\n',
    )
  }
  const rule = () => push('-'.repeat(W) + '\n')

  const printQr = (label: string, value: string) => {
    if (!value) return
    const qrData = ascii(value)
    const length = qrData.length + 3

    center(label)
    align(1)
    push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0)
    push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, W >= 42 ? 6 : 5)
    push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31)
    push(
      GS, 0x28, 0x6b,
      length & 0xff, (length >> 8) & 0xff,
      0x31, 0x50, 0x30, qrData,
    )
    push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30)
    push('\n')
    align(0)
  }

  push(ESC, 0x40)

  // Restaurant logo (best-effort: continue printing if the image cannot load).
  if (restaurant.logo_url) {
    try {
      const logo = await logoToPrinterBytes(restaurant.logo_url, W >= 42 ? 384 : 256)
      align(1)
      push(logo)
      push('\n')
      align(0)
    } catch (err) {
      console.warn('Could not print restaurant logo:', err)
    }
  }

  // Restaurant header.
  if (restaurant.show_name_in_bill) {
    const name = ascii(restaurant.name).toUpperCase()
    bold(true)
    if (name.length * 2 <= W) {
      textSize(0x11)
      center(name)
      textSize(0)
    } else {
      center(name)
    }
    bold(false)
  }
  if (restaurant.address) center(restaurant.address)
  if (restaurant.phone) center(`Ph: ${restaurant.phone}`)
  if (restaurant.gstin) center(`GSTIN: ${restaurant.gstin}`)
  if (restaurant.fssai_no) center(`FSSAI: ${restaurant.fssai_no}`)
  center(formatDate(order.created_at))

  rule()
  lr('Order #', String(order.order_number))
  if (tableNumber) lr('Table', String(tableNumber))
  lr('Order Type', String(order.order_type))
  rule()

  // Items.
  lr('ITEM', 'AMOUNT')
  for (const item of items) {
    const unit = Number(item.unit_price || 0)
    bold(true)
    left(item.menu_item_name || String(item.menu_item_id))
    bold(false)

    const modifiers = (item.modifiers || [])
      .map((modifier) => {
        const adjustment = Number(modifier.price_adjustment || 0)
        const name = modifier.modifier_option_name
        return `${name}${adjustment > 0 ? ` (+${money(adjustment)})` : adjustment < 0 ? ` (-${money(Math.abs(adjustment))})` : ''}`
      })
      .filter(Boolean)
      .join(', ')

    if (modifiers) left(`  ${modifiers}`)

    const detail = item.weight_grams
      ? `${formatWeight(item.weight_grams)} x ${money(ratePerKg(unit, item.weight_grams))}/kg`
      : `${item.quantity} x ${money(unit)}`
    lr(`  ${detail}`, money(unit * item.quantity))
  }

  rule()
  lr(`Subtotal${restaurant.tax_inclusive ? ' (incl. GST)' : ''}`, money(b.subtotal))
  if (b.discount > 0) {
    lr(`Discount (${restaurant.discount_percent}%)`, `-${money(b.discount)}`)
  }
  if (b.coupon > 0) {
    lr(coupon.code ? `Coupon (${coupon.code})` : 'Coupon / points discount', `-${money(b.coupon)}`)
  }
  if (b.serviceCharge > 0) {
    lr(`Service Charge (${restaurant.service_charge_percent}%)`, money(b.serviceCharge))
  }
  if (b.otherCharges > 0) {
    lr(`Other Charges (${restaurant.other_charges_percent}%)`, money(b.otherCharges))
  }
  if (b.extra > 0) {
    lr('Extra Charges', money(b.extra))
  }
  if (restaurant.tax_rate > 0) {
    if (isParcel) {
      lr(`IGST (${restaurant.tax_rate}%)`, money(b.cgst + b.sgst))
    } else {
      lr(`CGST (${restaurant.tax_rate / 2}%)`, money(b.cgst))
      lr(`SGST (${restaurant.tax_rate / 2}%)`, money(b.sgst))
    }
  }

  rule()
  bold(true)
  textSize(0x01)
  center('GRAND TOTAL')
  center(`Rs. ${money(b.grandTotal)}`)
  textSize(0)
  bold(false)
  rule()

  // UPI payment QR.
  if (restaurant.upi_id) {
    const upi = `upi://pay?pa=${restaurant.upi_id}&am=${b.grandTotal.toFixed(2)}&cu=INR`
    printQr('Scan to Pay', upi)
    center(restaurant.upi_id)
    rule()
  }

  // Google Review QR and configured social links.
  const social = (restaurant.bill_social_keys || [])
    .map((key) => ({
      key,
      label: SOCIAL_LABELS[key] || key,
      url: restaurant.social_links?.[key],
    }))
    .filter((entry) => !!entry.url)

  const review = social.find((entry) => entry.key === 'google_review')
  if (review?.url) {
    printQr('Scan to Review us on Google', review.url)
    rule()
  }

  const socialToPrint = social.filter((entry) => entry.key !== 'google_review')
  if (socialToPrint.length) {
    center('Follow us:')
    socialToPrint.forEach((entry) => {
      center(`${entry.label}:`)
      left(entry.url)
    })
    rule()
  }

  center('Thank you for dining with us!')
  if (restaurant.gstin) center('This is a computer generated bill')

  push('\n\n\n\n')
  push(GS, 0x56, 1)
  return new Uint8Array(out)
}

/**
 * Prints a bill. If a thermal printer is (or can silently be) connected it goes straight
 * to the printer; otherwise it falls back to the browser's print dialog.
 */
export async function printBillData(data: BillData): Promise<void> {
  try {
    const ready =
      !!getConnectedPrinter() || (await silentReconnectUSB()) || (await silentReconnectBluetooth())
    if (ready) {
      await printRaw(await buildBillBytes(data))
      return
    }
  } catch (err) {
    console.error('Direct print failed, falling back to browser print', err)
    toast.error('Printer not responding - opening the print dialog instead')
  }
  await printHtml(buildBillDocument(data))
}

/** Print the standard bill for any order id. Used by every "Print Bill / Receipt" button. */
export async function printBill(orderId: string, tableNumber?: string): Promise<void> {
  const data = await loadBillData(orderId, tableNumber)
  await printBillData(data)
}
