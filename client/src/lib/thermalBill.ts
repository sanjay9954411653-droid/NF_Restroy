/**
 * The customer bill as raw ESC/POS bytes, for a directly-connected thermal
 * printer (no print dialog). Same numbers as the on-screen / HTML bill —
 * they come from computeBill().
 */
import type { BillData, computeBill } from './billPrint'
import { formatDate } from './utils'
import { formatWeight, ratePerKg } from './weight'
import { getPrinterPrefs, paperCols } from './printerSettings'
import { bytes, ascii } from './thermalPrinter'
import { orderTypeLabel } from './orderTypeLabel'

const ESC = 0x1b
const GS = 0x1d

const rs = (n: number) => `Rs.${Number(n || 0).toFixed(2)}`

function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const w0 of text.split(/\s+/).filter(Boolean)) {
    let w = w0
    while (w.length > width) {
      if (cur) { lines.push(cur); cur = '' }
      lines.push(w.slice(0, width))
      w = w.slice(width)
    }
    if (!cur) cur = w
    else if ((cur + ' ' + w).length <= width) cur += ' ' + w
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

/** "Left text ........ right" on one line (left wraps if too long). */
function twoCol(left: string, right: string, W: number): string[] {
  const room = Math.max(8, W - right.length - 1)
  const parts = wrap(left, room)
  return [parts[0].padEnd(W - right.length) + right, ...parts.slice(1)]
}

/** Native printer QR code (works on most ESC/POS printers). */
function qr(data: string, size = 6): number[] {
  const d = Array.from(data, (c) => c.charCodeAt(0) & 0xff)
  const len = d.length + 3
  return [
    GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0,            // model 2
    GS, 0x28, 0x6b, 3, 0, 49, 67, size,             // module size
    GS, 0x28, 0x6b, 3, 0, 49, 69, 49,               // error correction M
    GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 49, 80, 48, ...d, // store data
    GS, 0x28, 0x6b, 3, 0, 49, 81, 48,               // print it
  ]
}

/** `logo`: optional raster bytes from logoRasterBytes(), printed centred above the name. */
export function buildBillBytes(data: BillData, b: ReturnType<typeof computeBill>, logo?: number[] | null): Uint8Array {
  const prefs = getPrinterPrefs()
  const W = paperCols(prefs)
  const { order, items, restaurant, tableNumber, coupon } = data
  const isParcel = order.order_type !== 'DINE_IN'
  const out: number[] = []

  const raw = (...p: Array<number | string | number[]>) => { out.push(...bytes(...p)) }
  const align = (n: 0 | 1) => raw(ESC, 0x61, n)
  const bold = (on: boolean) => raw(ESC, 0x45, on ? 1 : 0)
  const text = (s: string) => raw(ascii(s) + '\n')
  const rows = (l: string, r: string) => twoCol(ascii(l), ascii(r), W).forEach((x) => raw(x + '\n'))
  const rule = (ch = '-') => raw(ch.repeat(W) + '\n')

  raw(ESC, 0x40)

  // Header
  align(1)
  if (logo && getPrinterPrefs().printLogo) out.push(...logo)
  if (restaurant.show_name_in_bill) {
    bold(true); raw(GS, 0x21, 0x11); text(restaurant.name.toUpperCase()); raw(GS, 0x21, 0x00); bold(false)
  }
  if (restaurant.address) wrap(ascii(restaurant.address), W).forEach(text)
  if (restaurant.phone) text(`Ph: ${restaurant.phone}`)
  if (restaurant.gstin) text(`GSTIN: ${restaurant.gstin}`)
  if (restaurant.fssai_no) text(`FSSAI: ${restaurant.fssai_no}`)
  text(formatDate(order.created_at))
  align(0)
  rule()

  rows('Order #', String(order.order_number))
  if (tableNumber) rows('Table', String(tableNumber))
  rows('Type', orderTypeLabel(order.order_type))
  rule()

  // Items
  bold(true); rows('Item', 'Amount'); bold(false)
  for (const item of items) {
    const unit = Number(item.unit_price || 0)
    bold(true); rows(item.menu_item_name || String(item.menu_item_id), rs(unit * item.quantity)); bold(false)
    const mods = (item.modifiers || []).map((m: any) => m.modifier_option_name).join(', ')
    if (mods) text(`  ${mods}`)
    text(item.weight_grams
      ? `  ${formatWeight(item.weight_grams)} x ${rs(ratePerKg(unit, item.weight_grams))}/kg`
      : `  ${item.quantity} x ${rs(unit)}`)
  }
  rule()

  // Totals
  rows(`Subtotal${restaurant.tax_inclusive ? ' (incl. GST)' : ''}`, rs(b.subtotal))
  if (b.discount > 0) rows(`Discount (${restaurant.discount_percent}%)`, `-${rs(b.discount)}`)
  if (b.coupon > 0) rows(coupon.code ? `Coupon (${coupon.code})` : 'Coupon / points', `-${rs(b.coupon)}`)
  if (b.serviceCharge > 0) rows(`Service Chg (${restaurant.service_charge_percent}%)`, rs(b.serviceCharge))
  if (b.otherCharges > 0) rows(`Other Chg (${restaurant.other_charges_percent}%)`, rs(b.otherCharges))
  if (b.extra > 0) rows('Extra Charges', rs(b.extra))
  if (restaurant.tax_rate > 0) {
    if (isParcel) rows(`IGST (${restaurant.tax_rate}%)`, rs(b.cgst + b.sgst))
    else {
      rows(`CGST (${restaurant.tax_rate / 2}%)`, rs(b.cgst))
      rows(`SGST (${restaurant.tax_rate / 2}%)`, rs(b.sgst))
    }
  }
  rule('=')
  bold(true); rows('GRAND TOTAL', rs(b.grandTotal)); bold(false)
  rule('=')

  // UPI QR
  if (restaurant.upi_id && prefs.printUpiQr) {
    align(1)
    raw('\n')
    out.push(...qr(`upi://pay?pa=${restaurant.upi_id}&am=${b.grandTotal.toFixed(2)}&cu=INR`))
    text(`Scan to Pay: ${restaurant.upi_id}`)
    align(0)
  }

  align(1)
  raw('\n')
  text('Thank you for dining with us!')
  if (restaurant.gstin) text('This is a computer generated bill')
  align(0)

  raw(prefs.autoCutter ? '\n\n\n' : '\n\n\n\n\n')
  if (prefs.autoCutter) raw(GS, 0x56, 1)
  return new Uint8Array(out)
}
