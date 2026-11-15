// Helpers for items sold by weight (price per kg / per 100 g).
// The server works out the real price from the weight; this only previews it,
// using the exact same formula so the number on screen matches the bill.

export type PriceUnit = 'PIECE' | 'KG' | '100G'
export type WeightEntryUnit = 'g' | 'kg'

export const isWeighed = (unit?: string | null): unit is 'KG' | '100G' =>
  unit === 'KG' || unit === '100G'

/** "per kg" / "per 100 g" / "" for normal items */
export const priceUnitSuffix = (unit?: string | null): string =>
  unit === 'KG' ? '/ kg' : unit === '100G' ? '/ 100 g' : ''

/** Amount for an ordered weight, rounded off to the nearest rupee — same rounding as the server. */
export function weightedAmount(price: number, unit: PriceUnit | undefined, grams: number): number {
  if (!isWeighed(unit) || !(grams > 0)) return 0
  const perGram = Number(price) / (unit === 'KG' ? 1000 : 100)
  // Rounded off to the nearest whole rupee (Rs 119.70 -> Rs 120), as is usual for goods sold by weight
  return Math.round(perGram * grams)
}

/** Weight (whole grams) you get for an amount of money, e.g. Rs 100 at Rs 400/kg -> 250 g. */
export function gramsForAmount(price: number, unit: PriceUnit | undefined, amount: number): number {
  if (!isWeighed(unit) || !(Number(price) > 0) || !(amount > 0)) return 0
  const perGram = Number(price) / (unit === 'KG' ? 1000 : 100)
  const g0 = Math.round(amount / perGram)
  // Prices are rounded to whole rupees, so look at the grams just either side and pick one whose
  // price comes out EXACTLY at the typed amount (e.g. Rs 120 at Rs 1050/kg -> 114 g -> Rs 120).
  for (const g of [g0, g0 - 1, g0 + 1, g0 - 2, g0 + 2]) {
    if (g > 0 && weightedAmount(price, unit, g) === Math.round(amount)) return g
  }
  return g0
}

/** 350 -> "350 g", 1250 -> "1.25 kg" */
export function formatWeight(grams?: number | null): string {
  const g = Number(grams) || 0
  if (g <= 0) return ''
  if (g < 1000) return `${g} g`
  const kg = g / 1000
  return `${Number.isInteger(kg) ? kg : parseFloat(kg.toFixed(3))} kg`
}

/** Entered value + unit -> whole grams (0 when empty/invalid) */
export function toGrams(value: string | number, unit: WeightEntryUnit): number {
  const n = typeof value === 'number' ? value : parseFloat(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(unit === 'kg' ? n * 1000 : n)
}

/** Rate per kg worked out from a weighed order line (amount / grams). */
export function ratePerKg(amount: number, grams?: number | null): number {
  const g = Number(grams) || 0
  if (g <= 0) return 0
  return Math.round((Number(amount) / g) * 1000 * 100) / 100
}
