/**
 * Real-time "Call Waiter" / "Request Bill" alerts.
 *
 * Connects to the same Socket.io server the admin dashboard uses, joins this
 * restaurant's room, and keeps a live list of PENDING requests. On a new
 * request it vibrates the device, plays a short beep, and shows a toast —
 * this only fires while the waiter app is open on screen (same as the
 * Kitchen Display's live updates).
 */

import { create } from 'zustand'
import { io, Socket } from 'socket.io-client'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import { useOrderStore } from './useOrderStore'
import { isIncomingPending } from '../lib/orderRounds'

export interface TableRequest {
  id: string
  type: 'CALL_WAITER' | 'REQUEST_BILL'
  created_at: string
  table_number: string
}

interface TableRequestsState {
  requests: TableRequest[]
  connected: boolean
  reconnecting: boolean
  connect: (token: string, restaurantId: string) => void
  disconnect: () => void
  fetchPending: () => Promise<void>
  resolve: (id: string) => Promise<void>
}

let socket: Socket | null = null
let visibilityHandlerAttached = false

const REQUEST_LABEL: Record<TableRequest['type'], string> = {
  CALL_WAITER: 'needs a waiter',
  REQUEST_BILL: 'wants the bill',
}

// Two short beeps via the Web Audio API — no audio file needed. Browsers
// generally require a prior user gesture (e.g. the login tap) before audio
// is allowed to play, which the waiter app already has by the time this fires.
// ── Customer orders (QR / WhatsApp / Zomato) waiting for a waiter to accept ──
let seenIncoming: Set<string> | null = null
const incomingIds = (): Set<string> =>
  new Set(useOrderStore.getState().orders.filter(isIncomingPending).map((o) => o.id))

function alertNewIncoming(before: Set<string>) {
  const now = incomingIds()
  if (seenIncoming === null) seenIncoming = before
  const fresh = [...now].filter((id) => !seenIncoming!.has(id))
  seenIncoming = new Set([...seenIncoming, ...now])
  if (fresh.length === 0) return
  if ('vibrate' in navigator) navigator.vibrate([400, 150, 400, 150, 400])
  playAlertSound()
  toast(`${fresh.length} new customer order${fresh.length > 1 ? 's' : ''} — open Orders to accept`, { icon: '🛎️', duration: 10000 })
}

function playAlertSound() {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const beep = (delay: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.001, ctx.currentTime + delay)
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + delay + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.25)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + delay)
      osc.stop(ctx.currentTime + delay + 0.3)
    }
    beep(0)
    beep(0.35)
  } catch {
    // Audio not available — vibration + toast still fire.
  }
}

export const useTableRequestsStore = create<TableRequestsState>((set, get) => ({
  requests: [],
  connected: false,
  // True once we've been disconnected for a few seconds — used to show a
  // "reconnecting" hint without flashing it during the brief gap every
  // normal (re)connect goes through.
  reconnecting: false,

  connect: (token, restaurantId) => {
    if (socket) return

    // Prefer a websocket, but allow falling back to HTTP polling — some
    // hosting proxies don't pass a raw websocket upgrade through cleanly,
    // and polling-then-upgrade (socket.io's own default) is more reliable
    // than forcing websocket only.
    //
    // `auth` is a callback rather than a fixed `{ token }` object so every
    // (re)connect attempt — including the automatic ones after the phone
    // wakes up — sends whatever access token is current in localStorage,
    // not the one that was valid when the tab first loaded. The access
    // token only lives 15 minutes, and a fixed token meant every
    // reconnection past that point silently failed to authenticate, so
    // "Call Waiter" / "Request Bill" alerts just stopped after a while.
    socket = io(import.meta.env.VITE_SOCKET_URL || '', {
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: localStorage.getItem('waiter_token') || token }),
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })

    let reconnectingTimer: ReturnType<typeof setTimeout> | null = null
    const clearReconnectingTimer = () => {
      if (reconnectingTimer) clearTimeout(reconnectingTimer)
      reconnectingTimer = null
    }

    socket.on('connect', () => {
      clearReconnectingTimer()
      set({ connected: true, reconnecting: false })
      socket?.emit('join_restaurant', { restaurantId })
      // Catch up on anything raised while we were disconnected.
      get().fetchPending()
      useOrderStore.getState().fetchOrders()
    })

    socket.on('disconnect', (reason) => {
      set({ connected: false })
      console.warn('[table-requests] socket disconnected:', reason)
      // Only show a "reconnecting" hint if it takes more than a few
      // seconds — most disconnects recover almost immediately.
      clearReconnectingTimer()
      reconnectingTimer = setTimeout(() => set({ reconnecting: true }), 4000)
    })

    socket.on('connect_error', (err) => {
      console.warn('[table-requests] socket connect_error:', err.message)
    })

    // Phones commonly suspend the socket connection while the screen is
    // locked or the app is in the background (to save battery), and it can
    // fail to silently resume on its own. When the app becomes visible or
    // regains network again, force a reconnect attempt and refresh the
    // list via the regular API so nothing was missed.
    if (!visibilityHandlerAttached) {
      visibilityHandlerAttached = true
      const tryResume = () => {
        if (document.visibilityState !== 'visible') return
        if (socket && !socket.connected) socket.connect()
        get().fetchPending()
      }
      document.addEventListener('visibilitychange', tryResume)
      window.addEventListener('focus', tryResume)
      window.addEventListener('online', tryResume)
    }

    socket.on('TABLE_REQUEST_CREATED', (payload: any) => {
      set((state) => ({
        requests: [
          ...state.requests,
          {
            id: payload.request_id,
            type: payload.type,
            created_at: new Date().toISOString(),
            table_number: payload.table_number || '',
          },
        ],
      }))

      if ('vibrate' in navigator) navigator.vibrate([300, 100, 300, 100, 300])
      playAlertSound()
      toast(
        `Table ${payload.table_number || ''} ${REQUEST_LABEL[payload.type as TableRequest['type']] || 'needs help'}`,
        { icon: payload.type === 'REQUEST_BILL' ? '🧾' : '🔔', duration: 8000 },
      )
    })

    // ── Orders: keep the Orders tab live, and alert when the kitchen finishes a round ──
    let orderRefreshTimer: ReturnType<typeof setTimeout> | null = null
    const refreshOrders = () => {
      if (orderRefreshTimer) clearTimeout(orderRefreshTimer)
      orderRefreshTimer = setTimeout(async () => {
        const before = incomingIds()
        await useOrderStore.getState().fetchOrders()
        alertNewIncoming(before)
      }, 300)
      window.dispatchEvent(new Event('kot-orders-changed')) // lets a "kitchen printer station" print new tickets
    }
    socket.on('ORDER_CREATED', refreshOrders)
    socket.on('ORDER_UPDATED', refreshOrders)
    socket.on('ORDER_COMPLETED', refreshOrders)
    socket.on('ORDER_CANCELLED', refreshOrders)

    socket.on('ROUND_READY', (payload: any) => {
      refreshOrders()
      if ('vibrate' in navigator) navigator.vibrate([300, 100, 300, 100, 300])
      playAlertSound()
      const where = payload.table_number ? `Table ${payload.table_number}` : `Order ${payload.order_number}`
      toast(`${where} — order is ready to serve`, { icon: '🍽️', duration: 10000 })
    })

    socket.on('TABLE_REQUEST_RESOLVED', (payload: any) => {
      set((state) => ({
        requests: state.requests.filter((r) => r.id !== payload.request_id),
      }))
    })
  },

  disconnect: () => {
    socket?.close()
    socket = null
    set({ connected: false, reconnecting: false, requests: [] })
  },

  fetchPending: async () => {
    try {
      const res = await api.get<{ success: boolean; data: TableRequest[] }>('/table-requests')
      set({ requests: res.data.data || [] })
    } catch {
      // Non-fatal — the live socket feed will still populate new ones.
    }
  },

  resolve: async (id) => {
    set((state) => ({ requests: state.requests.filter((r) => r.id !== id) }))
    try {
      await api.post(`/table-requests/${id}/resolve`)
    } catch {
      // If this fails the request will simply reappear on the next fetchPending().
    }
  },
}))
