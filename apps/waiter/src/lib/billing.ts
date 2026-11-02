/**
 * One bill calculation shared by the staff Bill screen and the customer's
 * cart, so both always show the same numbers.
 *
 * All the rates come from the restaurant's own settings (Settings → Bill
 * Settings / QR Settings), so when the owner changes GST or a charge, the
 * customer's cart changes with it.
 *
 * Order of calculation:
 *   1. Discount % off the raw item subtotal
 *   2. Service charge % + Other charges % (on the discounted amount)
 *   3. Flat extra charge
 *   4. GST on the taxable base (or backed out of the price if tax-inclusive)
 */

export interface BillingSettings {
  tax_rate: number
  tax_inclusive: boolean
  discount_percent: number
  service_charge_percent: number
  other_charges_percent: number
  extra_charges_amount: number
}

/** Used only if the server hasn't sent billing settings (older backend). */
export const LEGACY_BILLING: BillingSettings = {
  tax_rate: 18,
  tax_inclusive: false,
  discount_percent: 0,
  service_charge_percent: 0,
  other_charges_percent: 0,
  extra_charges_amount: 0,
}

/** Turns whatever the API sent into safe numbers (NUMERIC columns can arrive as strings). */
export function normalizeBilling(raw: Partial<Record<keyof BillingSettings, unknown>> | null | undefined): BillingSettings {
  if (!raw) return LEGACY_BILLING
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return {
    tax_rate: n(raw.tax_rate),
    tax_inclusive: Boolean(raw.tax_inclusive),
    discount_percent: n(raw.discount_percent),
    service_charge_percent: n(raw.service_charge_percent),
    other_charges_percent: n(raw.other_charges_percent),
    extra_charges_amount: n(raw.extra_charges_amount),
  }
}

export function calcBill(rawSubtotal: number, s: BillingSettings, couponDiscount = 0) {
  const { tax_rate: taxRate, tax_inclusive: inclusive } = s
  // Coupon comes off first, then the restaurant's own discount % applies to what is left.
  const coupon = Math.min(Math.max(0, couponDiscount), rawSubtotal)
  const base = rawSubtotal - coupon
  const discount = (base * (s.discount_percent || 0)) / 100
  const afterDiscount = base - discount

  let preTaxTotal: number
  let taxAmount: number

  if (inclusive && taxRate > 0) {
    // Prices already include GST — back-calculate the base from the discounted amount
    const base = afterDiscount / (1 + taxRate / 100)
    taxAmount = afterDiscount - base
    preTaxTotal = base
  } else {
    preTaxTotal = afterDiscount
    taxAmount = 0
  }

  const serviceCharge = (preTaxTotal * (s.service_charge_percent || 0)) / 100
  const otherCharges = (preTaxTotal * (s.other_charges_percent || 0)) / 100
  const extra = s.extra_charges_amount || 0

  if (!inclusive && taxRate > 0) {
    const taxableBase = preTaxTotal + serviceCharge + otherCharges + extra
    taxAmount = (taxableBase * taxRate) / 100
  }

  const cgst = taxAmount / 2
  const sgst = taxAmount / 2
  const grandTotal = preTaxTotal + serviceCharge + otherCharges + extra + taxAmount

  return { subtotal: rawSubtotal, discount, coupon, serviceCharge, otherCharges, extra, taxAmount, cgst, sgst, grandTotal }
}
