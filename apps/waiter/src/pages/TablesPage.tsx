/**
 * Tables Page — the waiter's command center.
 *
 * Colour-coded occupancy at a glance:
 *   🟢 Free          → tap to start a NEW order
 *   🔵 Occupied      → has an open order (shows ₹ + items); tap to add items
 *   🟡 Ready to pay  → order is READY; tap to view / add
 *
 * Pulls GET /tables/with-status so each table carries its active order.
 * Auto-refreshes every 15s so colours stay reasonably live without sockets.
 */

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useCartStore, draftItemCount } from '../store/useCartStore'
import { tablesApi, ordersApi } from '../api/endpoints'
import { getErrorMessage } from '../api/client'
import type { TableWithStatus, PickupOrder } from '../types'
import { usePayable } from '../lib/usePayable'

type Occupancy = 'free' | 'occupied' | 'ready'

const styles: Record<Occupancy, { card: string; badge: string; label: string }> = {
  free:     { card: 'border-gray-200',                       badge: 'bg-emerald-50 text-emerald-700', label: 'Free' },
  occupied: { card: 'border-blue-300 ring-2 ring-blue-100',  badge: 'bg-blue-50 text-blue-700',       label: 'Occupied' },
  ready:    { card: 'border-amber-300 ring-2 ring-amber-100', badge: 'bg-amber-50 text-amber-700',    label: 'Ready' },
}

function occupancyOf(t: TableWithStatus): Occupancy {
  if (!t.active_order) return 'free'
  return t.active_order.status === 'READY' ? 'ready' : 'occupied'
}

const TablesPage: React.FC = () => {
  const navigate = useNavigate()
  const payable = usePayable()
  const begin = useCartStore((st) => st.begin)
  const drafts = useCartStore((st) => st.drafts)   // unsent items per table
  const [tables, setTables] = useState<TableWithStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [pickups, setPickups] = useState<PickupOrder[]>([])

  const fetchTables = useCallback(async () => {
    try {
      const res = await tablesApi.withStatus()
      setTables(res.data.data || [])
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPickups = useCallback(async () => {
    try {
      const res = await ordersApi.activePickups()
      setPickups(res.data.data || [])
    } catch { /* tables still work without it */ }
  }, [])

  useEffect(() => {
    fetchTables()
    fetchPickups()
    const t = setInterval(() => { fetchTables(); fetchPickups() }, 15000) // keep occupancy fresh
    return () => clearInterval(t)
  }, [fetchTables, fetchPickups])

  const [picker, setPicker] = useState<TableWithStatus | null>(null)
  const [pickupAllowed, setPickupAllowed] = useState(true)

  useEffect(() => {
    tablesApi.myAccess().then((r) => setPickupAllowed(r.data.data.pickup)).catch(() => {})
  }, [])

  const openOrdersOf = (t: TableWithStatus) => t.active_orders && t.active_orders.length > 0 ? t.active_orders : (t.active_order ? [t.active_order] : [])
  const nextGuestLabel = (t: TableWithStatus) => {
    const used = openOrdersOf(t).map((o) => o.guest_label || 'A')
    return ['A', 'B', 'C', 'D', 'E', 'F'].find((l) => !used.includes(l)) || 'G'
  }

  // Unsent items waiting on a table: its own new-order draft + drafts to add to its placed orders
  const draftCountOf = (t: TableWithStatus) =>
    draftItemCount(drafts[`new:${t.id}`]) +
    openOrdersOf(t).reduce((n, o) => n + draftItemCount(drafts[`add:${o.id}`]), 0)

  const startSeparateOrder = (table: TableWithStatus) => {
    // Opens this table's draft (keeps whatever was already added to it)
    begin(`new:${table.id}`, { tableId: table.id, tableNumber: table.table_number, orderType: 'DINE_IN', guestLabel: nextGuestLabel(table) })
    navigate(`/order/new?table=${table.table_number}&guest=${nextGuestLabel(table)}`)
  }

  const handleTableSelect = (table: TableWithStatus) => {
    if (table.active_order) {
      // Occupied — let the waiter pick which guest's order, or start a separate one
      setPicker(table)
      return
    }
    // Free — open its draft (new, or the one the waiter left earlier)
    begin(`new:${table.id}`, { tableId: table.id, tableNumber: table.table_number, orderType: 'DINE_IN', guestLabel: null })
    navigate('/order/new')
  }

  const handlePickupOrder = () => {
    begin('new:pickup', { tableId: null, tableNumber: null, orderType: 'PARCEL', guestLabel: null })
    navigate('/order/new')
  }

  const freeCount = tables.filter((t) => !t.active_order).length
  const occCount = tables.filter((t) => t.active_order && t.active_order.status !== 'READY').length
  const readyCount = tables.filter((t) => t.active_order?.status === 'READY').length

  return (
    <div className="p-4 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tables</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {freeCount} free · {occCount} occupied · {readyCount} ready
        </p>
      </div>

      {/* Pick-up */}
      {pickupAllowed && (
      <button
        onClick={handlePickupOrder}
        className="w-full card p-4 flex items-center gap-4 hover:border-indigo-300 transition-colors text-left"
      >
        <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center text-2xl shrink-0">
          📦
        </div>
        <div>
          <p className="font-semibold text-gray-900">Pick-up</p>
          <p className="text-sm text-gray-500">No table — order to go</p>
          {draftItemCount(drafts['new:pickup']) > 0 && (
            <p className="text-xs font-semibold text-amber-600 mt-0.5">Draft · {draftItemCount(drafts['new:pickup'])} items not sent</p>
          )}
        </div>
      </button>
      )}

      {/* Open pick-up orders — tap one to add items */}
      {pickupAllowed && pickups.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Open pick-up orders ({pickups.length})
          </p>
          <div className="space-y-2">
            {pickups.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/order/add/${p.id}?table=Pick-up`)}
                className={`w-full card p-3 flex items-center justify-between text-left hover:border-indigo-300 ${
                  p.status === 'READY' ? 'border-emerald-300 ring-2 ring-emerald-100' : ''
                }`}
              >
                <span>
                  <span className="font-semibold text-gray-900">#{p.order_number.slice(-4)}</span>
                  <span className="text-xs text-gray-500 ml-2">{p.item_count} items</span>
                  <span className={`block text-xs font-medium mt-0.5 ${p.status === 'READY' ? 'text-emerald-600' : 'text-gray-500'}`}>
                    {p.status === 'READY' ? 'Ready for pick-up' : p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                  </span>
                </span>
                <span className="font-semibold text-gray-700">₹{payable(p.total_amount).toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Free</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Occupied</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Ready</span>
      </div>

      {/* Table grid */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Dine-in Tables
        </p>
        {loading ? (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card p-4 h-24 animate-pulse bg-gray-100" />
            ))}
          </div>
        ) : tables.length === 0 ? (
          <div className="card p-8 text-center text-gray-400">
            <p>No tables found</p>
            <p className="text-xs mt-1">Check your connection</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {tables.map((table) => {
              const occ = occupancyOf(table)
              const s = styles[occ]
              return (
                <button
                  key={table.id}
                  onClick={() => handleTableSelect(table)}
                  disabled={!table.is_active}
                  className={`card p-3 text-center hover:shadow-md transition-all active:scale-95 disabled:opacity-40 ${s.card}`}
                >
                  <p className="text-xl font-bold text-gray-900">{table.table_number}</p>
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-medium ${s.badge}`}>
                    {s.label}
                  </span>
                  {draftCountOf(table) > 0 && (
                    <p className="text-[10px] font-bold text-amber-600 mt-1">📝 Draft · {draftCountOf(table)}</p>
                  )}
                  {table.active_order ? (
                    <p className="text-xs font-semibold text-gray-700 mt-1">
                      {openOrdersOf(table).length > 1
                        ? `${openOrdersOf(table).length} orders`
                        : `₹${payable(table.active_order.total_amount).toFixed(2)}`}
                    </p>
                  ) : (
                    <p className="text-[10px] text-gray-400 mt-1">{table.seats} seats</p>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {picker && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setPicker(null)}>
          <div className="w-full bg-white rounded-t-2xl p-4 space-y-2 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <p className="font-bold text-gray-900">Table {picker.table_number}</p>
              <button onClick={() => setPicker(null)} className="text-gray-400 text-sm">Close</button>
            </div>
            {openOrdersOf(picker).map((o) => (
              <button
                key={o.id}
                onClick={() => { navigate(`/order/add/${o.id}?table=${picker.table_number}&guest=${o.guest_label || 'A'}`); setPicker(null) }}
                className="w-full card p-3 flex items-center justify-between text-left hover:border-indigo-300"
              >
                <span>
                  <span className="font-semibold text-gray-900">Guest {o.guest_label || 'A'}</span>
                  <span className="text-xs text-gray-500 ml-2">{o.item_count} items · {o.status}</span>
                  {draftItemCount(drafts[`add:${o.id}`]) > 0 && (
                    <span className="text-xs font-semibold text-amber-600 ml-2">📝 +{draftItemCount(drafts[`add:${o.id}`])} draft</span>
                  )}
                </span>
                <span className="font-semibold text-gray-700">₹{payable(o.total_amount).toFixed(2)}</span>
              </button>
            ))}
            <button
              onClick={() => { const t = picker; setPicker(null); startSeparateOrder(t) }}
              className="w-full p-3 rounded-xl bg-indigo-600 text-white font-semibold"
            >
              + New separate order (Guest {nextGuestLabel(picker)}){draftItemCount(drafts[`new:${picker.id}`]) > 0 ? ` · 📝 ${draftItemCount(drafts[`new:${picker.id}`])} in draft` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default TablesPage
