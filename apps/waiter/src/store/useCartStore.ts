/**
 * Cart store — one DRAFT per table / order.
 *
 * A waiter can add items to Table 1, go and start Table 2, come back to Table 1
 * later, add more, and only then place the order. Each table's unsent items are a
 * "draft" that stays until the order is placed or the waiter discards it.
 * Drafts are saved on the phone, so they survive leaving the screen or a refresh.
 *
 * `cart` / `notes` / `tableId`... always describe the draft that is open right now
 * (the one named by `contextKey`); every change is mirrored into `drafts`.
 *
 * Draft keys:  new:<tableId>   a new order for a table
 *              new:pickup      a pick-up order
 *              add:<orderId>   more items for an order that is already placed
 *
 * Lines are identified by line_id (not menu_item_id) because one by-weight dish
 * can appear several times (e.g. 500 g and 250 g), each as its own line.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartLine, NewCartLine, OrderType, OrderSource } from '../types'

export interface Draft {
  cart:        CartLine[]
  notes:       string
  tableId:     string | null
  tableNumber: string | null
  orderType:   OrderType
  guestLabel:  string | null
  updatedAt:   number
}

/** Where a new-order draft is for (set by the tables screen). */
export interface DraftMeta {
  tableId:     string | null
  tableNumber: string | null
  orderType:   OrderType
  guestLabel?: string | null
}

interface CartState {
  contextKey:   string | null   // the draft that is open right now
  tableId:      string | null
  tableNumber:  string | null
  orderType:    OrderType
  orderSource:  OrderSource
  guestLabel:   string | null
  notes:        string
  cart:         CartLine[]
  drafts:       Record<string, Draft>

  begin:        (contextKey: string, meta?: DraftMeta) => void
  setTable:     (id: string | null, number: string | null) => void
  setOrderType: (type: OrderType) => void
  setNotes:     (notes: string) => void
  addItem:      (item: NewCartLine) => void
  removeItem:   (lineId: string) => void
  changeQty:    (lineId: string, delta: number) => void
  setNote:      (lineId: string, note: string) => void
  setWeight:    (lineId: string, grams: number, amount: number) => void
  clear:        () => void          // order placed or discarded: remove the open draft
  resetAll:     () => void          // logout: remove every draft

  total:        () => number
  count:        () => number
}

/** Number of items in a draft (for the "Draft · 3 items" badges). */
export const draftItemCount = (d?: Draft | null): number =>
  d ? d.cart.reduce((s, c) => s + c.quantity, 0) : 0

const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000   // forgotten drafts expire after 12 hours

let lineSeq = 0
const newLineId = () => `l${Date.now().toString(36)}${(lineSeq++).toString(36)}`

const EMPTY_ACTIVE = {
  contextKey: null as string | null,
  tableId: null as string | null,
  tableNumber: null as string | null,
  guestLabel: null as string | null,
  notes: '',
  cart: [] as CartLine[],
}

/** Apply a cart / notes change to the open draft and mirror it into `drafts`. */
const commit = (s: CartState, patch: { cart?: CartLine[]; notes?: string }): Partial<CartState> => {
  const cart = patch.cart ?? s.cart
  const notes = patch.notes ?? s.notes
  const key = s.contextKey
  if (!key) return { cart, notes }
  const drafts = { ...s.drafts }
  if (cart.length === 0 && !notes.trim()) {
    delete drafts[key]
  } else {
    drafts[key] = {
      cart, notes,
      tableId: s.tableId, tableNumber: s.tableNumber,
      orderType: s.orderType, guestLabel: s.guestLabel,
      updatedAt: Date.now(),
    }
  }
  return { cart, notes, drafts }
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      ...EMPTY_ACTIVE,
      orderType:   'DINE_IN',
      orderSource: 'WAITER',
      drafts:      {},

      // Open the draft for a table / order (starts empty if there isn't one yet).
      begin: (contextKey, meta) =>
        set((s) => {
          if (s.contextKey === contextKey && !meta) return s
          const d = s.drafts[contextKey]
          return {
            contextKey,
            cart: d?.cart ?? [],
            notes: d?.notes ?? '',
            tableId: meta ? meta.tableId : d?.tableId ?? null,
            tableNumber: meta ? meta.tableNumber : d?.tableNumber ?? null,
            orderType: meta ? meta.orderType : d?.orderType ?? 'DINE_IN',
            guestLabel: meta ? meta.guestLabel ?? null : d?.guestLabel ?? null,
          }
        }),

      setTable: (id, number) => set({ tableId: id, tableNumber: number }),
      setOrderType: (type) => set({ orderType: type }),
      setNotes: (notes) => set((s) => commit(s, { notes })),

      addItem: (item) =>
        set((s) => {
          // A weighed portion is always its own line (the server wants quantity 1 per weighed line)
          if (item.weight_grams) {
            return commit(s, { cart: [...s.cart, { ...item, line_id: newLineId() }] })
          }
          // Normal / by-piece: one line per dish — tapping + again raises its quantity and keeps any note
          const existing = s.cart.find((c) => c.menu_item_id === item.menu_item_id && !c.weight_grams)
          if (existing) {
            return commit(s, {
              cart: s.cart.map((c) =>
                c.line_id === existing.line_id ? { ...c, quantity: c.quantity + item.quantity } : c,
              ),
            })
          }
          return commit(s, { cart: [...s.cart, { ...item, line_id: newLineId() }] })
        }),

      removeItem: (lineId) =>
        set((s) => commit(s, { cart: s.cart.filter((c) => c.line_id !== lineId) })),

      changeQty: (lineId, delta) =>
        set((s) =>
          commit(s, {
            cart: s.cart
              .map((c) => {
                if (c.line_id !== lineId) return c
                if (c.weight_grams) return delta < 0 ? { ...c, quantity: 0 } : c // weighed line: only remove
                return { ...c, quantity: c.quantity + delta }
              })
              .filter((c) => c.quantity > 0),
          }),
        ),

      setNote: (lineId, note) =>
        set((s) =>
          commit(s, {
            cart: s.cart.map((c) => (c.line_id === lineId ? { ...c, special_instructions: note } : c)),
          }),
        ),

      // Change the weight of a weighed line (amount = the new price for that weight)
      setWeight: (lineId, grams, amount) =>
        set((s) =>
          commit(s, {
            cart: s.cart.map((c) => (c.line_id === lineId ? { ...c, weight_grams: grams, price: amount } : c)),
          }),
        ),

      clear: () =>
        set((s) => {
          const drafts = { ...s.drafts }
          if (s.contextKey) delete drafts[s.contextKey]
          return { ...EMPTY_ACTIVE, orderType: 'DINE_IN', drafts }
        }),

      resetAll: () => set({ ...EMPTY_ACTIVE, orderType: 'DINE_IN', drafts: {} }),

      total: () => get().cart.reduce((sum, c) => sum + c.price * c.quantity, 0),
      count: () => get().cart.reduce((sum, c) => sum + c.quantity, 0),
    }),
    {
      name: 'waiter-cart-drafts',
      version: 1,
      partialize: (s) => ({
        drafts: s.drafts, contextKey: s.contextKey, cart: s.cart, notes: s.notes,
        tableId: s.tableId, tableNumber: s.tableNumber, orderType: s.orderType, guestLabel: s.guestLabel,
      }),
      // On app start: drop drafts nobody touched for 12 hours
      merge: (persisted: any, current) => {
        const now = Date.now()
        const drafts: Record<string, Draft> = {}
        for (const [k, d] of Object.entries<Draft>(persisted?.drafts || {})) {
          if (d && now - d.updatedAt < DRAFT_MAX_AGE_MS) drafts[k] = d
        }
        const open = persisted?.contextKey && drafts[persisted.contextKey]
        return { ...current, ...persisted, drafts, ...(open ? {} : { ...EMPTY_ACTIVE }) }
      },
    },
  ),
)
