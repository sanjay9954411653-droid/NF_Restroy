import { useEffect, useState, useRef, useCallback } from 'react'
import toast from 'react-hot-toast'
import api from '../api'
import { useSocket } from '../contexts/SocketContext'
import { Order, OrderStatus } from '../types/order'
import { ClockIcon, CheckCircleIcon, WifiIcon, ExclamationCircleIcon, PrinterIcon } from '@heroicons/react/24/outline'
import { formatElapsed } from '../lib/utils'
import { formatWeight } from '../lib/weight'
import { printKOT } from '../components/PrintKOT'
import {
  enablePushNotifications,
  disablePushNotifications,
  getPushStatus,
  getPushSupport,
  type PushStatus,
} from '../lib/push'
import {
  connectUSB,
  connectBluetooth,
  silentReconnectUSB,
  silentReconnectBluetooth,
  getConnectedPrinter,
  printKOTRaw,
  isPrinterSupported,
  type PrinterKind,
} from '../lib/thermalPrinter'

type SortBy = 'time' | 'priority'

/** Groups items by kitchen round (trip). Items with no round are treated as round 1. */
function groupByRound<T extends { round?: number }>(items: T[]): Array<{ round: number; items: T[] }> {
  const map = new Map<number, T[]>()
  for (const it of items) {
    const r = it.round || 1
    if (!map.has(r)) map.set(r, [])
    map.get(r)!.push(it)
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([round, items]) => ({ round, items }))
}

interface OrderWithItems extends Order {
  items?: Array<{
    id?: string
    menu_item_id: string
    menu_item_name?: string
    quantity: number
    weight_grams?: number | null // items sold by weight: ordered weight (quantity is 1)
    special_instructions?: string
    status?: 'PENDING' | 'PREPARING' | 'DONE'
  }>
  order_items?: Array<{
    id?: string
    menu_item_id: string
    menu_item_name?: string
    quantity: number
    weight_grams?: number | null // items sold by weight: ordered weight (quantity is 1)
    special_instructions?: string
    status?: 'PENDING' | 'PREPARING' | 'DONE'
  }>
}

const CARD_COLORS: Record<string, string> = {
  CREATED:   'border-gray-500 bg-gray-900',
  PREPARING: 'border-amber-400 bg-amber-950',
  READY:     'border-emerald-400 bg-emerald-950',
  ACCEPTED:  'border-blue-400 bg-blue-950',
}

const AUTO_PRINT_KEY = 'kitchen_auto_print'

const Kitchen: React.FC = () => {
  const [orders, setOrders] = useState<OrderWithItems[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('time')
  const [printer, setPrinter] = useState<PrinterKind | null>(null)
  const [showPrinterMenu, setShowPrinterMenu] = useState(false)
  const [autoPrint, setAutoPrint] = useState(() => localStorage.getItem(AUTO_PRINT_KEY) !== 'off')
  const [pushStatus, setPushStatus] = useState<PushStatus>('default')
const [pushBusy, setPushBusy] = useState(false)
  const seenOrderIds = useRef<Set<string> | null>(null) // null = first load not done yet
  // Track delayed order IDs so we can highlight them on the card
  const [delayedOrderIds, setDelayedOrderIds] = useState<Set<string>>(new Set())
  const audioRef = useRef<HTMLAudioElement>(null)
  const { on, off, isConnected } = useSocket()

  const [showBlockedHelp, setShowBlockedHelp] = useState(false)

  useEffect(() => {
  setPushStatus(getPushStatus())
}, [])
  const handleTogglePush = async () => {
  // Browsers never let a page re-request a permission it was explicitly
  // denied — only the person can undo that from the browser's own site
  // settings. So instead of doing nothing (or being unclickable, which is
  // invisible on a touchscreen kitchen tablet), show them how.
  if (pushStatus === 'denied') {
    setShowBlockedHelp(true)
    return
  }

  setPushBusy(true)

  try {
    if (pushStatus === 'granted') {
      await disablePushNotifications()
      setPushStatus('default')
    } else {
      const ok = await enablePushNotifications()
      setPushStatus(ok ? 'granted' : getPushStatus())
    }
  } finally {
    setPushBusy(false)
  }
  }

  const fetchOrders = useCallback(async () => {
    try {
      const res = await api.get('/orders', { params: { limit: 100 } })
      const all: OrderWithItems[] = res.data.data?.items || []
      // Kitchen only shows pre-service stages. READY orders leave the kitchen display
      // immediately — waiter handles payment from the Orders / Tables screen.
      const active = all.filter((o) => ['CREATED', 'ACCEPTED', 'PREPARING'].includes(o.status))
      setOrders(active)

      // Auto-print only items that haven't been sent to the kitchen yet.
      // This correctly handles both a brand-new order AND items added to an
      // already-in-progress table bill — either way, only the new round
      // prints, never the items that already went out.
      if (autoPrint && getConnectedPrinter()) {
        for (const order of active) {
          const allItems = (order.order_items || order.items || []) as any[]
          const unprinted = allItems.filter((it) => !it.kot_printed_at)
          if (unprinted.length === 0) continue
          try {
            // One ticket per round, so a customer's later add-on is its own KOT
            for (const g of groupByRound(unprinted)) {
              await printKOTRaw(order, g.items as any, undefined, g.round)
            }
            await api.post(`/orders/${order.id}/kot-printed`, { item_ids: unprinted.map((it) => it.id) })
          } catch {
            toast.error(`Couldn't auto-print order ${order.order_number} — printer may have disconnected`, { duration: 6000 })
          }
        }
      }
      seenOrderIds.current = new Set(active.map((o) => o.id))
    } catch (err) {
      toast.error('Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [autoPrint])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // On load, try to silently reconnect to whichever printer was last used —
  // no prompt shown. If it can't (browser restarted, permission not
  // rememberable for this printer type), the header shows "Connect Printer".
  useEffect(() => {
    (async () => {
      if (await silentReconnectUSB()) { setPrinter('usb'); return }
      if (await silentReconnectBluetooth()) setPrinter('bluetooth')
    })()
  }, [])

  const handleConnect = async (kind: PrinterKind) => {
    setShowPrinterMenu(false)
    try {
      if (kind === 'usb') await connectUSB()
      else await connectBluetooth()
      setPrinter(kind)
      toast.success(`${kind === 'usb' ? 'USB' : 'Bluetooth'} printer connected`)
    } catch (err: any) {
      if (err?.name !== 'NotFoundError') toast.error(err?.message || 'Could not connect to printer')
    }
  }

  const toggleAutoPrint = () => {
    const next = !autoPrint
    setAutoPrint(next)
    localStorage.setItem(AUTO_PRINT_KEY, next ? 'on' : 'off')
  }

  // Tick every second for elapsed timers — forces re-render for live timers
  useEffect(() => {
    const t = setInterval(() => {}, 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const refresh = () => { playSound(); fetchOrders() }
    on('ORDER_CREATED', refresh)
    on('ORDER_UPDATED', fetchOrders)
    // When an order is delayed, add it to the highlighted set and show a toast
    on('ORDER_DELAYED', (data: { order_id: string; order_number: string; minutes_elapsed: number; threshold_minutes: number }) => {
      setDelayedOrderIds((prev) => new Set([...prev, data.order_id]))
      toast.error(
        `⚠️ Order ${data.order_number} delayed — ${data.minutes_elapsed}m (threshold: ${data.threshold_minutes}m)`,
        { duration: 8000, id: `delay-${data.order_id}` }
      )
    })
    // When an order is completed/cancelled, remove from delayed set
    on('ORDER_COMPLETED', (data: { order_id: string }) => {
      setDelayedOrderIds((prev) => { const s = new Set(prev); s.delete(data.order_id); return s })
    })
    on('ORDER_CANCELLED', (data: { order_id: string }) => {
      setDelayedOrderIds((prev) => { const s = new Set(prev); s.delete(data.order_id); return s })
    })
    return () => {
      off('ORDER_CREATED')
      off('ORDER_UPDATED')
      off('ORDER_DELAYED')
      off('ORDER_COMPLETED')
      off('ORDER_CANCELLED')
    }
  }, [on, off, fetchOrders])

  const playSound = () => {
    audioRef.current?.play().catch(() => {})
  }

  const updateStatus = async (id: string, status: OrderStatus) => {
    if (busy) return
    setBusy(true)
    try {
      await api.patch(`/orders/${id}`, { status })
      setOrders((p) =>
        status === 'COMPLETED' || status === 'CANCELLED'
          ? p.filter((o) => o.id !== id)
          : p.map((o) => (o.id === id ? { ...o, status } : o))
      )
      if (status === 'COMPLETED') toast.success('Order completed!', { icon: '✅' })
    } catch (err) {
      toast.error('Failed to update order')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Mark a single item as DONE (or toggle back to PENDING).
   * If all items are done, the backend auto-advances the order to READY.
   */
  const toggleItemDone = async (orderId: string, itemId: string, currentStatus: string) => {
    if (busy) return
    setBusy(true)
    const newStatus = currentStatus === 'DONE' ? 'PENDING' : 'DONE'
    try {
      const res = await api.patch(`/orders/${orderId}/items/${itemId}`, { status: newStatus })
      const { order_auto_advanced } = res.data.data

      // Update item status in local state
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== orderId) return o
          const updateItems = (arr: any[]) =>
            arr.map((item) => (item.id === itemId ? { ...item, status: newStatus } : item))
          return {
            ...o,
            items: o.items ? updateItems(o.items) : o.items,
            order_items: o.order_items ? updateItems(o.order_items) : o.order_items,
            // If auto-advanced, update order status too
            status: order_auto_advanced ? 'READY' : o.status,
          }
        })
      )

      if (order_auto_advanced) {
        toast.success('All items done — order marked READY! 🎉', { duration: 5000 })
      }
    } catch (err) {
      toast.error('Failed to update item')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Per-round actions. Each round card has its own status, worked out from its
   * own items, so acting on one round never changes the other rounds.
   */
  const ensureOrderPreparing = async (order: OrderWithItems) => {
    if (order.status !== 'PREPARING') await api.patch(`/orders/${order.id}`, { status: 'PREPARING' })
  }

  const startRound = async (order: OrderWithItems, roundItems: any[]) => {
    if (busy) return
    setBusy(true)
    try {
      await ensureOrderPreparing(order)
      for (const it of roundItems.filter((i) => i.id && i.status === 'PENDING')) {
        await api.patch(`/orders/${order.id}/items/${it.id}`, { status: 'PREPARING' })
      }
      await fetchOrders()
    } catch {
      toast.error('Failed to start preparing')
    } finally {
      setBusy(false)
    }
  }

  const finishRound = async (order: OrderWithItems, roundItems: any[]) => {
    if (busy) return
    setBusy(true)
    try {
      await ensureOrderPreparing(order)
      const remaining = roundItems.filter((i) => i.id && i.status !== 'DONE')
      for (const it of remaining) {
        // The last item of the last round auto-advances the whole order to READY
        await api.patch(`/orders/${order.id}/items/${it.id}`, { status: 'DONE' })
      }
      // Everything already done but order not READY yet (e.g. items ticked one by one)
      const all = (order.order_items || order.items || []) as any[]
      if (remaining.length === 0 && all.every((i) => i.status === 'DONE')) {
        await api.patch(`/orders/${order.id}`, { status: 'READY' })
      }
      await fetchOrders()
    } catch {
      toast.error('Failed to mark ready')
    } finally {
      setBusy(false)
    }
  }

  const sorted = [...orders].sort((a, b) => {
    if (sortBy === 'priority') return (b.priority_score || 0) - (a.priority_score || 0)
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })

  const getElapsedColor = (createdAt: string) => {
    const mins = (Date.now() - new Date(createdAt).getTime()) / 60000
    if (mins > 20) return 'text-red-400'
    if (mins > 10) return 'text-amber-400'
    return 'text-emerald-400'
  }

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden kitchen-font">
      {/* Hidden audio */}
      <audio ref={audioRef} preload="auto">
        <source src="data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU" />
      </audio>

      {/* Header */}
      <header className="bg-gray-900 border-b-2 border-indigo-500 px-3 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-wider text-white">KITCHEN DISPLAY</h1>
          <p className="text-gray-400 text-xs sm:text-sm mt-0.5">
            {sorted.filter((o) => o.status === 'CREATED').length > 0 && (
              <span className="text-gray-300 font-semibold">{sorted.filter((o) => o.status === 'CREATED').length} new · </span>
            )}
            {sorted.filter((o) => o.status === 'ACCEPTED').length} accepted ·{' '}
            {sorted.filter((o) => o.status === 'PREPARING').length} preparing
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full sm:w-auto">
          {/* Connection */}
          <div className="flex items-center gap-1.5">
            {isConnected ? (
              <><WifiIcon className="w-4 h-4 text-emerald-400" /><span className="text-xs text-emerald-400">Live</span></>
            ) : (
              <><ExclamationCircleIcon className="w-4 h-4 text-amber-400" /><span className="text-xs text-amber-400">Offline</span></>
            )}
          </div>

          {/* Sort */}
          <div className="flex gap-2">
            {(['time', 'priority'] as SortBy[]).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  sortBy === s ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {s === 'time' ? 'By Time' : 'By Priority'}
              </button>
            ))}
          </div>

          {/* Printer */}
          <div className="relative">
            <button
              onClick={() => (printer ? toggleAutoPrint() : setShowPrinterMenu((v) => !v))}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                printer
                  ? autoPrint ? 'bg-emerald-700 text-white' : 'bg-gray-800 text-gray-400'
                  : 'bg-amber-600 text-white'
              }`}
              title={printer ? 'Tap to turn auto-print on/off' : 'Connect a kitchen printer'}
            >
              <PrinterIcon className="w-4 h-4" />
              {printer
                ? autoPrint ? 'Auto-print ON' : 'Auto-print OFF'
                : 'Connect Printer'}
            </button>

            {showPrinterMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-10">
                {isPrinterSupported().usb && (
                  <button
                    onClick={() => handleConnect('usb')}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700"
                  >
                    Connect via USB
                  </button>
                )}
                {isPrinterSupported().bluetooth && (
                  <button
                    onClick={() => handleConnect('bluetooth')}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700"
                  >
                    Connect via Bluetooth
                  </button>
                )}
                <button
                  onClick={() => setShowPrinterMenu(false)}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-700 border-t border-gray-700"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

                    {getPushSupport() && (
            <button
              onClick={handleTogglePush}
              disabled={pushBusy}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                pushStatus === 'granted'
                  ? 'bg-emerald-700 text-white'
                  : pushStatus === 'denied'
                  ? 'bg-red-900 text-red-300'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
              title={
                pushStatus === 'denied'
                  ? 'Tap for how to unblock notifications'
                  : 'Toggle kitchen order notifications'
              }
            >
              {pushBusy
                ? 'Notifications…'
                : pushStatus === 'granted'
                ? '🔔 Notifications ON'
                : pushStatus === 'denied'
                ? '🔕 Notifications Blocked — tap to fix'
                : '🔕 Notifications OFF'}
            </button>
          )}

          {showBlockedHelp && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onClick={() => setShowBlockedHelp(false)}
            >
              <div
                className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 text-sm text-gray-200 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-base font-bold text-white mb-2">Notifications are blocked</h3>
                <p className="text-gray-400 mb-3">
                  This browser was told to block notifications for this page, and no
                  website can undo that itself — it has to be changed in the browser.
                </p>
                <p className="font-semibold text-white mb-1">On this Android tablet (Chrome):</p>
                <ol className="list-decimal list-inside space-y-1 text-gray-300 mb-4">
                  <li>Tap the <span className="text-white">🔒 / ⓘ</span> icon left of the address bar</li>
                  <li>Tap <span className="text-white">Permissions</span> → <span className="text-white">Notifications</span></li>
                  <li>Set it to <span className="text-white">Allow</span></li>
                  <li>Reload this page</li>
                </ol>
                <p className="text-gray-500 text-xs mb-4">
                  Not listed there? Chrome menu (⋮) → Settings → Site settings →
                  Notifications → find this site → Allow.
                </p>
                <button
                  onClick={() => setShowBlockedHelp(false)}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg"
                >
                  Got it
                </button>
              </div>
            </div>
          )}
          
          <button
            onClick={fetchOrders}
            className="px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Refresh
          </button>
        </div>
      </header>

      {!printer && (
        <div className="bg-amber-900/40 text-amber-200 text-xs text-center py-1.5 px-4 shrink-0">
          No kitchen printer connected — new orders won't print automatically. Tap "Connect Printer" above.
        </div>
      )}

      {/* Orders grid */}
      <div className="flex-1 overflow-auto p-2 sm:p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-400">Loading orders…</div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <CheckCircleIcon className="w-16 h-16 text-emerald-500 opacity-50" />
            <p className="text-2xl text-gray-400 font-medium">All caught up!</p>
            <p className="text-gray-600 text-sm">No active orders in the kitchen</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {sorted.flatMap((order) => {
              // Every round of an order becomes its own card (same order number,
              // only that round's items). Order status/actions stay shared.
              const allItems = (order.order_items || order.items || []) as any[]
              const rounds = groupByRound(allItems)
              const orderAllDone = allItems.length > 0 && allItems.every((i: any) => i.status === 'DONE')
              return rounds
                .map((g) => {
                  const done = g.items.every((i: any) => i.status === 'DONE')
                  const started = g.items.some((i: any) => i.status === 'PREPARING' || i.status === 'DONE')
                  // Status of THIS round only
                  const roundStatus: OrderStatus =
                    done && orderAllDone ? 'PREPARING' // whole order finished -> show "Mark Ready"
                    : done ? 'READY'
                    : started ? 'PREPARING'
                    : order.status === 'CREATED' ? 'CREATED'
                    : 'ACCEPTED'
                  return { order, round: g.round, items: g.items, totalRounds: rounds.length, roundStatus, hidden: done && !orderAllDone }
                })
                .filter((t) => !t.hidden) // a finished round leaves the kitchen while other rounds are still open
            }).map(({ order, round, items, totalRounds, roundStatus }) => {
              const isDelayed = delayedOrderIds.has(order.id) && round === 1
              // Delayed orders get a red border regardless of status
              const cardColor = isDelayed
                ? 'border-red-500 bg-red-950'
                : (CARD_COLORS[roundStatus] || 'border-gray-600 bg-gray-900')
              // Item timestamps can arrive without a timezone; treat those as UTC so the timer isn't negative
              const asUtc = (t: string) => (/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`)
              const itemTimes = (items as any[]).map((i) => i.created_at && asUtc(String(i.created_at))).filter(Boolean).sort()
              const roundStartedAt: string = round > 1 && itemTimes[0] ? itemTimes[0] : order.created_at
              const elapsedColor = getElapsedColor(roundStartedAt)

              return (
                <div
                  key={`${order.id}-${round}`}
                  className={`rounded-xl border-2 ${cardColor} flex flex-col min-h-[280px] overflow-hidden`}
                >
                  {/* Card header */}
                  <div className="px-4 py-3 border-b border-white/10">
                    <div className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-2">
                        <span className="text-xl font-bold text-white">{order.order_number}</span>
                        {totalRounds > 1 && (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${round > 1 ? 'bg-amber-500 text-black' : 'bg-white/15 text-white'}`}>
                            ROUND {round}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isDelayed && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500 text-white animate-pulse">
                            DELAYED
                          </span>
                        )}
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            roundStatus === 'READY'
                              ? 'bg-emerald-500 text-white'
                              : roundStatus === 'PREPARING'
                              ? 'bg-amber-500 text-white'
                              : roundStatus === 'CREATED'
                              ? 'bg-gray-500 text-white'
                              : 'bg-blue-500 text-white'
                          }`}
                        >
                          {roundStatus}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className={`flex items-center gap-1 font-mono font-bold ${elapsedColor}`}>
                        <ClockIcon className="w-3.5 h-3.5" />
                        {formatElapsed(roundStartedAt)}
                      </span>
                      {order.table?.table_number && (
                        <span className="text-gray-400">Table {order.table.table_number}</span>
                      )}
                      {(order as any).token_number && (
                        <span className="text-emerald-300 font-bold text-sm tracking-wide">
                          🎫 {(order as any).token_number}
                        </span>
                      )}
                      <span className="text-gray-500 uppercase text-xs">{order.order_source}</span>
                      {/* Item progress: X/Y done */}
                      {items.length > 0 && (
                        <span className="ml-auto text-xs font-medium text-white/60">
                          {items.filter((i) => i.status === 'DONE').length}/{items.length} done
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Items */}
                  <div className="flex-1 px-4 py-3 space-y-2 overflow-y-auto scrollbar-thin">
                    {items.map((item: any, idx: number) => {
                      const isDone = item.status === 'DONE'
                      return (
                        <div key={item.id || idx} className={`flex items-start gap-2 transition-opacity ${isDone ? 'opacity-50' : ''}`}>
                          {/* Checkbox — tapping marks item done/pending */}
                          <button
                            onClick={() => item.id && toggleItemDone(order.id, item.id, item.status || 'PENDING')}
                            disabled={busy}
                            className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                              isDone
                                ? 'bg-emerald-500 border-emerald-500'
                                : 'border-white/40 hover:border-white/80 bg-transparent'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                            title={isDone ? 'Undo' : 'Mark done'}
                          >
                            {isDone && (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                          <span className="min-w-[1.25rem] h-5 px-1 rounded bg-white/10 flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5 whitespace-nowrap">
                            {item.weight_grams ? formatWeight(item.weight_grams) : item.quantity}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium leading-tight ${isDone ? 'line-through text-white/40' : 'text-white'}`}>
                              {item.menu_item_name || item.menu_item_id}
                            </p>
                            {item.special_instructions && (
                              <p className="text-xs text-amber-300 mt-0.5">
                                📝 {item.special_instructions}
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {order.special_instructions && (
                      <div className="mt-2 p-2 bg-white/5 rounded-lg text-xs text-gray-300">
                        📋 {order.special_instructions}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="px-4 py-3 border-t border-white/10 space-y-2">
                    {roundStatus === 'CREATED' && (
                      <button
                        onClick={() => updateStatus(order.id, 'ACCEPTED')}
                        disabled={busy}
                        className="w-full py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Accept Order ✓
                      </button>
                    )}
                    {roundStatus === 'ACCEPTED' && (
                      <button
                        onClick={() => startRound(order, items as any[])}
                        disabled={busy}
                        className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Start Preparing
                      </button>
                    )}
                    {roundStatus === 'PREPARING' && (
                      <button
                        onClick={() => finishRound(order, items as any[])}
                        disabled={busy}
                        className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Mark Ready ✓
                      </button>
                    )}
                    {/* READY orders disappear from kitchen — waiter collects payment */}
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
  const unprinted = items.filter((it: any) => !it.kot_printed_at)
  const toPrint = unprinted.length > 0 ? unprinted : items

  try {
    const ready =
      !!getConnectedPrinter() ||
      (await silentReconnectUSB()) ||
      (await silentReconnectBluetooth())

    if (ready) {
      for (const g of groupByRound(toPrint as any[])) {
        await printKOTRaw(order, g.items as any, 'Kitchen', g.round)
      }
      toast.success('KOT sent to thermal printer')
    } else {
      for (const g of groupByRound(toPrint as any[])) {
        printKOT(order, g.items as any, 'Kitchen', g.round)
      }
    }

    if (unprinted.length > 0) {
      await api.post(`/orders/${order.id}/kot-printed`, {
        item_ids: unprinted.map((it: any) => it.id),
      })
    }
  } catch (err: any) {
    toast.error(err?.message || 'Could not print KOT')
  }
}}
                        className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1"
                        title="Print KOT"
                      >
                        <PrinterIcon className="w-3.5 h-3.5" />
                        KOT
                      </button>
                      {/* Cancel applies to the whole order, so only the first card offers it */}
                      {round === 1 && (
                        <button
                          onClick={() => updateStatus(order.id, 'CANCELLED')}
                          disabled={busy}
                          className="flex-1 py-1.5 bg-transparent border border-red-500/50 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default Kitchen
