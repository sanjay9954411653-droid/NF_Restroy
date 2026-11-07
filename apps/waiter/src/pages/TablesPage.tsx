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
import { useCartStore } from '../store/useCartStore'
import { tablesApi } from '../api/endpoints'
import { getErrorMessage } from '../api/client'
import type { TableWithStatus } from '../types'
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
  const { setTable, setOrderType, clear } = useCartStore()
  const [tables, setTables] = useState<TableWithStatus[]>([])
  const [loading, setLoading] = useState(true)

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

  useEffect(() => {
    fetchTables()
    const t = setInterval(fetchTables, 15000) // keep occupancy fresh
    return () => clearInterval(t)
  }, [fetchTables])

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

  const startSeparateOrder = (table: TableWithStatus) => {
    clear()
    setTable(table.id, table.table_number)
    setOrderType('DINE_IN')
    navigate(`/order/new?table=${table.table_number}&guest=${nextGuestLabel(table)}`)
  }

  const handleTableSelect = (table: TableWithStatus) => {
    if (table.active_order) {
      // Occupied — let the waiter pick which guest's order, or start a separate one
      setPicker(table)
      return
    }
    // Free — start a new dine-in order
    clear()
    setTable(table.id, table.table_number)
    setOrderType('DINE_IN')
    navigate('/order/new')
  }

  const handlePickupOrder = () => {
    clear()
    setTable(null, null)
    setOrderType('PARCEL')
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
        </div>
      </button>
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
                </span>
                <span className="font-semibold text-gray-700">₹{payable(o.total_amount).toFixed(2)}</span>
              </button>
            ))}
            <button
              onClick={() => { const t = picker; setPicker(null); startSeparateOrder(t) }}
              className="w-full p-3 rounded-xl bg-indigo-600 text-white font-semibold"
            >
              + New separate order (Guest {nextGuestLabel(picker)})
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default TablesPage
