/**
 * All API calls used by the Waiter App.
 * Typed, centralised — no raw axios calls in components.
 */

import { api } from './client'
import type { Order, Table, TableWithStatus, MenuItem, MenuCategory, CartLine, OrderType, OrderSource } from '../types'

// ── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ success: boolean; data: { token: string; refreshToken: string; user: any } }>('/auth/login', { email, password }),

  me: () =>
    api.get<{ success: boolean; data: any }>('/auth/me'),

  refresh: (refreshToken: string) =>
    api.post<{ success: boolean; data: { token: string; refreshToken: string } }>('/auth/refresh', { refreshToken }),

  logout: (refreshToken: string) =>
    api.post('/auth/logout', { refreshToken }),
}

// ── Tables ───────────────────────────────────────────────────────────────────

export const tablesApi = {
  list: () =>
    api.get<{ success: boolean; data: Table[] }>('/tables'),

  // Tables enriched with their active order (occupancy command-center view)
  withStatus: () =>
    api.get<{ success: boolean; data: TableWithStatus[] }>('/tables/with-status'),

  // What this waiter may access (pick-up allowed or not)
  myAccess: () =>
    api.get<{ success: boolean; data: { restricted: boolean; pickup: boolean } }>('/tables/my-access'),
}

// ── Menu ─────────────────────────────────────────────────────────────────────

export const menuApi = {
  categories: () =>
    api.get<{ success: boolean; data: MenuCategory[] }>('/menus/categories'),

  items: () =>
    api.get<{ success: boolean; data: MenuItem[] }>('/menus/items'),
}

// ── Orders ───────────────────────────────────────────────────────────────────

export interface CreateOrderPayload {
  table_id?: string | null
  guest_label?: string | null
  order_type: OrderType
  order_source: OrderSource
  special_instructions?: string
  items: Array<{ menu_item_id: string; quantity: number; special_instructions?: string }>
  idempotency_key?: string  // prevents duplicate orders on retry
}

export const ordersApi = {
  create: (payload: CreateOrderPayload) =>
    api.post<{ success: boolean; data: { order: Order } }>('/orders', payload, {
      headers: payload.idempotency_key
        ? { 'Idempotency-Key': payload.idempotency_key }
        : {},
    }),

  list: (params?: { limit?: number; offset?: number }) =>
        api.get<{ success: boolean; data: { items: Order[]; total: number; limit: number; offset: number; hasMore: boolean } }>('/orders', { params }),
  getById: (id: string) =>
    api.get<{ success: boolean; data: { order: Order } }>(`/orders/${id}`),

  updateStatus: (id: string, status: string) =>
    api.patch<{ success: boolean; data: Order }>(`/orders/${id}`, { status }),

  // Waiter confirms food was served (optionally only one round)
  serve: (id: string, round?: number) =>
    api.post(`/orders/${id}/serve`, round ? { round } : {}),

  addItems: (id: string, items: CartLine[]) =>
    api.post(`/orders/${id}/items`, {
      items: items.map((i) => ({
        menu_item_id: i.menu_item_id,
        quantity: i.quantity,
        special_instructions: i.special_instructions,
      })),
    }),

  getActiveByTable: (tableId: string) =>
    api.get<{ success: boolean; data: { order: Order; items: any[] } | null }>(
      `/orders/active/by-table/${tableId}`,
    ),
}

// ── Payments ──────────────────────────────────────────────────────────────────

export type PaymentMethod = 'CASH' | 'CARD' | 'UPI' | 'ONLINE'

export const paymentsApi = {
  create: (payload: {
    order_id: string
    amount: number
    method: PaymentMethod
    status?: 'PAID' | 'PENDING'
    reference_number?: string
  }) => api.post('/payments', payload),

  // Bill grand total (GST + charges - coupon), amount already paid, and what is left
  balance: (orderId: string) =>
    api.get<{ success: boolean; data: { total: number; paid: number; balance: number } }>(
      `/payments/order/${orderId}/balance`,
    ),
}
