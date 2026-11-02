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

/** Amount for an ordered weight — same rounding as the server. */
export function weightedAmount(price: number, unit: PriceUnit | undefined, grams: number): number {
  if (!isWeighed(unit) || !(grams > 0)) return 0
  const perGram = Number(price) / (unit === 'KG' ? 1000 : 100)
  return Math.round(perGram * grams * 100) / 100
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
