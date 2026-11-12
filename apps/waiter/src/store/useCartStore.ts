/**
 * Cart store — manages the current order being built.
 * Cleared after order is submitted.
 *
 * Lines are identified by line_id (not menu_item_id) because one by-weight dish
 * can appear several times (e.g. 500 g and 250 g), each as its own line.
 */

import { create } from 'zustand'
import type { CartLine, NewCartLine, OrderType, OrderSource } from '../types'

interface CartState {
  tableId:      string | null
  tableNumber:  string | null
  orderType:    OrderType
  orderSource:  OrderSource
  notes:        string
  cart:         CartLine[]
  contextKey:   string | null   // which table / order this cart belongs to

  begin:        (contextKey: string) => void
  setTable:     (id: string | null, number: string | null) => void
  setOrderType: (type: OrderType) => void
  setNotes:     (notes: string) => void
  addItem:      (item: NewCartLine) => void
  removeItem:   (lineId: string) => void
  changeQty:    (lineId: string, delta: number) => void
  setNote:      (lineId: string, note: string) => void
  setWeight:    (lineId: string, grams: number, amount: number) => void
  clear:        () => void

  total:        () => number
  count:        () => number
}

let lineSeq = 0
const newLineId = () => `l${Date.now().toString(36)}${(lineSeq++).toString(36)}`

export const useCartStore = create<CartState>()((set, get) => ({
  tableId:     null,
  tableNumber: null,
  orderType:   'DINE_IN',
  orderSource: 'WAITER',
  notes:       '',
  cart:        [],
  contextKey:  null,

  // Called when the order screen opens. A cart left over from a DIFFERENT table / order
  // (waiter pressed back, or left the screen) is thrown away, so items can never end up
  // on the wrong table.
  begin: (contextKey) =>
    set((state) => (state.contextKey === contextKey ? state : { cart: [], notes: '', contextKey })),

  setTable: (id, number) => set({ tableId: id, tableNumber: number }),
  setOrderType: (type) => set({ orderType: type }),
  setNotes: (notes) => set({ notes }),

  addItem: (item) => {
    set((state) => {
      // A weighed portion is always its own line (the server wants quantity 1 per weighed line)
      if (item.weight_grams) {
        return { cart: [...state.cart, { ...item, line_id: newLineId() }] }
      }
      // Normal / by-piece: one line per dish — tapping + again raises its quantity and keeps any note
      const existing = state.cart.find((c) => c.menu_item_id === item.menu_item_id && !c.weight_grams)
      if (existing) {
        return {
          cart: state.cart.map((c) =>
            c.line_id === existing.line_id ? { ...c, quantity: c.quantity + item.quantity } : c,
          ),
        }
      }
      return { cart: [...state.cart, { ...item, line_id: newLineId() }] }
    })
  },

  removeItem: (lineId) =>
    set((state) => ({ cart: state.cart.filter((c) => c.line_id !== lineId) })),

  changeQty: (lineId, delta) =>
    set((state) => ({
      cart: state.cart
        .map((c) => {
          if (c.line_id !== lineId) return c
          if (c.weight_grams) return delta < 0 ? { ...c, quantity: 0 } : c // weighed line: only remove
          return { ...c, quantity: c.quantity + delta }
        })
        .filter((c) => c.quantity > 0),
    })),

  setNote: (lineId, note) =>
    set((state) => ({
      cart: state.cart.map((c) => (c.line_id === lineId ? { ...c, special_instructions: note } : c)),
    })),

  // Change the weight of a weighed line (amount = the new price for that weight)
  setWeight: (lineId, grams, amount) =>
    set((state) => ({
      cart: state.cart.map((c) => (c.line_id === lineId ? { ...c, weight_grams: grams, price: amount } : c)),
    })),

  clear: () => set({ cart: [], tableId: null, tableNumber: null, notes: '', contextKey: null }),

  total: () => get().cart.reduce((s, c) => s + c.price * c.quantity, 0),
  count: () => get().cart.reduce((s, c) => s + c.quantity, 0),
}))
