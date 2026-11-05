/**
 * Selling by weight (e.g. sweets by the kg or per 100 g).
 *
 * A by-weight menu item stores its price per kg ('KG') or per 100 g ('100G').
 * When it is ordered with a weight, the order line keeps quantity = 1 and its
 * unit_price becomes the amount for that weight, so everything downstream
 * (quantity x unit_price totals, bills, GST, payments) works unchanged.
 *
 * The server is the only place the price is worked out; a client can never
 * send a price of its own. The formula is IDENTICAL to client/src/lib/weight.ts
 * (a test checks both on thousands of random weights), so the preview shown
 * while typing always equals the amount on the bill.
 */

export type PriceUnit = 'PIECE' | 'KG' | '100G';

export const MAX_WEIGHT_GRAMS = 100_000; // 100 kg: catches typos like 25000 kg

export const isWeighedUnit = (unit?: string | null): unit is 'KG' | '100G' =>
  unit === 'KG' || unit === '100G';

/** Amount for an ordered weight. Same maths and rounding as the client preview. */
export function weightedAmount(price: number | string, unit: PriceUnit | undefined, grams: number): number {
  if (!isWeighedUnit(unit) || !(grams > 0)) return 0;
  const perGram = Number(price) / (unit === 'KG' ? 1000 : 100);
  return Math.round(perGram * grams * 100) / 100;
}

/** 350 -> "350 g", 1250 -> "1.25 kg" */
export function formatWeight(grams?: number | null): string {
  const g = Number(grams) || 0;
  if (g <= 0) return '';
  if (g < 1000) return `${g} g`;
  const kg = g / 1000;
  return `${Number.isInteger(kg) ? kg : parseFloat(kg.toFixed(3))} kg`;
}

export interface PricedLine {
  unit_price: number;
  weight_grams: number | null;
}

/**
 * Works out the price of one order line for a menu item. Returns either the
 * price (and weight to store) or a plain-English error to show the staff.
 *
 *  - By-weight item  -> a weight is required, quantity must be 1, price = amount for that weight.
 *                       If the item also has a piece price, an order line WITHOUT a weight is a
 *                       by-piece line: quantity N x piece price.
 *  - Normal item     -> a weight is not allowed, price = menu price.
 */
export function priceOrderLine(
  menuItem: { name: string; price: number | string; price_unit?: string | null; piece_price?: number | string | null },
  line: { quantity: number; weight_grams?: number | null },
): PricedLine | { error: string } {
  const unit = menuItem.price_unit;

  if (isWeighedUnit(unit)) {
    const grams = Number(line.weight_grams) || 0;
    const piecePrice = menuItem.piece_price != null ? Number(menuItem.piece_price) : 0;
    if (!(grams > 0) && piecePrice > 0) {
      return { unit_price: piecePrice, weight_grams: null };
    }
    if (!(grams > 0)) {
      return { error: `"${menuItem.name}" is sold by weight. Enter the weight (e.g. 250 g).` };
    }
    if (!Number.isInteger(grams) || grams > MAX_WEIGHT_GRAMS) {
      return { error: `"${menuItem.name}": weight must be between 1 g and ${MAX_WEIGHT_GRAMS / 1000} kg.` };
    }
    if (line.quantity !== 1) {
      return { error: `"${menuItem.name}" is sold by weight: add it once with its weight.` };
    }
    return { unit_price: weightedAmount(menuItem.price, unit, grams), weight_grams: grams };
  }

  if (line.weight_grams) {
    return { error: `"${menuItem.name}" is not sold by weight.` };
  }
  return { unit_price: Number(menuItem.price), weight_grams: null };
}
