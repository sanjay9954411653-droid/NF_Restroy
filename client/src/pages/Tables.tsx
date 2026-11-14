/**
 * Tables — the command center for waiters and reception.
 *
 * Each table is colour-coded by occupancy so staff can see the whole floor at
 * a glance and act without hunting through the Orders list:
 *   🟢 Free            → tap to start a NEW order (POS opens pre-filled)
 *   🔵 Occupied        → has an open order (shows ₹ + item count); tap to manage
 *   🟡 Ready to pay    → order is READY; tap to print bill / collect payment
 *
 * Tapping an occupied table opens TableOrderPanel (a slide-over) with one-tap
 * actions: Add Items, Print KOT, Print Bill, Collect Payment, advance status.
 *
 * Admins still get the Add/Edit/Delete management controls.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import { useSocket } from '../contexts/SocketContext'
import { useAuth } from '../contexts/AuthContext'
import TableForm from '../components/TableForm'
import OrderForm from '../components/OrderForm'
import PaymentForm from '../components/PaymentForm'
import TableOrderPanel from '../components/TableOrderPanel'
import BillScreen from '../components/BillScreen'
import AddItemsModal from '../components/AddItemsModal'
import { formatRelative } from '../lib/utils'
import Button from '../components/Button'
import Card from '../components/Card'
import EmptyState from '../components/EmptyState'
import Loading from '../components/Loading'
import { Table, TableWithStatus, TableActiveOrder } from '../types/table'
import { usePayable } from '../lib/useBillTotal'
import {
  PlusIcon,
  Cog6ToothIcon,
  TableCellsIcon,
  TrashIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline'

// Visual treatment for each occupancy state
type Occupancy = 'free' | 'occupied' | 'ready'

const occupancyStyles: Record<Occupancy, { ring: string; badge: string; dot: string; label: string }> = {
  free: {
    ring: 'border-gray-200 hover:border-emerald-400',
    badge: 'bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-400',
    label: 'Free',
  },
  occupied: {
    ring: 'border-blue-300 ring-2 ring-blue-100 hover:border-blue-400',
    badge: 'bg-blue-50 text-blue-700',
    dot: 'bg-blue-500',
    label: 'Occupied',
  },
  ready: {
    ring: 'border-amber-300 ring-2 ring-amber-100 hover:border-amber-400',
    badge: 'bg-amber-50 text-amber-700',
    dot: 'bg-amber-400 animate-pulse',
    label: 'Ready to pay',
  },
}

// Open pick-up (parcel) orders shown under the tables
interface PickupOrder {
  id: string
  order_number: string
  token_number?: number | null
  status: string
  total_amount: number
  guest_label?: string | null
  item_count: number
  created_at: string
}

const PICKUP_STATUS: Record<string, { label: string; badge: string }> = {
  CREATED:          { label: 'New',        badge: 'bg-gray-100 text-gray-700' },
  ACCEPTED:         { label: 'Accepted',   badge: 'bg-blue-50 text-blue-700' },
  PREPARING:        { label: 'Preparing',  badge: 'bg-amber-50 text-amber-700' },
  READY:            { label: 'Ready — collect payment', badge: 'bg-emerald-50 text-emerald-700' },
  OUT_FOR_DELIVERY: { label: 'Out',        badge: 'bg-blue-50 text-blue-700' },
}

// Several guests can share one table (guest A, B, C…), each with their own open order.
// The API sends all of them in `active_orders` (oldest first); fall back to the latest one.
function openOrders(t: TableWithStatus): TableActiveOrder[] {
  if (t.active_orders && t.active_orders.length > 0) return t.active_orders
  return t.active_order ? [t.active_order] : []
}

function orderName(o: TableActiveOrder): string {
  return o.guest_label ? `Guest ${o.guest_label}` : `#${o.order_number.slice(-4)}`
}

// First unused guest letter (A, B, C…) for the next order on a table
function nextGuestLabel(orders: TableActiveOrder[]): string {
  const used = new Set(orders.map((o) => (o.guest_label || '').toUpperCase()))
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i)
    if (!used.has(letter)) return letter
  }
  return String(orders.length + 1)
}

// The table is "ready to pay" only when EVERY open order on it is ready
function getOccupancy(t: TableWithStatus): Occupancy {
  const orders = openOrders(t)
  if (orders.length === 0) return 'free'
  if (orders.every((o) => o.status === 'READY')) return 'ready'
  return 'occupied'
}

const Tables: React.FC = () => {
  const { on, off } = useSocket()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const [tables, setTables] = useState<TableWithStatus[]>([])
  const [loading, setLoading] = useState(true)

  // Admin table CRUD form
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Table | undefined>()
  const [manageMode, setManageMode] = useState(false)

  // Order flows
  const [orderForTable, setOrderForTable] = useState<TableWithStatus | null>(null) // new / add-items POS
  const [panelTable, setPanelTable] = useState<TableWithStatus | null>(null)        // occupied table drawer
  const [panelOrderId, setPanelOrderId] = useState<string | null>(null)              // which guest's order the drawer shows
  const [newGuestOrder, setNewGuestOrder] = useState(false)                            // POS opened for a separate guest order
  const [addItemsOrder, setAddItemsOrder] = useState<{ id: string; order_number: string } | null>(null) // add items to one guest's order
  const [payOrderId, setPayOrderId] = useState<string | null>(null)
  const [billOrderId, setBillOrderId] = useState<string | null>(null)               // bill screen for READY
  const [billTableNumber, setBillTableNumber] = useState<string | undefined>()
  const [panelRefresh, setPanelRefresh] = useState(0)

  // Pick-up orders (no table)
  const [pickups, setPickups] = useState<PickupOrder[]>([])
  const [pickupPanel, setPickupPanel] = useState<PickupOrder | null>(null)
  const [newPickup, setNewPickup] = useState(false)
  const [addItemsFor, setAddItemsFor] = useState<PickupOrder | null>(null)

  // The floor shows what the customer actually pays (items + charges + GST), same as the Bill.
  const payable = usePayable()

  const fetchTables = useCallback(async () => {
    try {
      const res = await api.get('/tables/with-status')
      const list: TableWithStatus[] = res.data.data || []
      setTables(list)
      // Keep an open drawer in sync (an order may have been paid / added); close it when the table is free
      setPanelTable((cur) => {
        if (!cur) return cur
        const fresh = list.find((t) => t.id === cur.id)
        return fresh && openOrders(fresh).length > 0 ? fresh : null
      })
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPickups = useCallback(async () => {
    try {
      const res = await api.get('/orders/pickups/active')
      const list: PickupOrder[] = res.data.data || []
      setPickups(list)
      // A pick-up that was cancelled or finished disappears — close its drawer too
      setPickupPanel((cur) => (cur && !list.some((p) => p.id === cur.id) ? null : cur))
    } catch { /* the tables still work if this fails */ }
  }, [])

  useEffect(() => { fetchTables(); fetchPickups() }, [fetchTables, fetchPickups])

  // Refetch occupancy on any order/table change so colours stay live
  useEffect(() => {
    const refresh = () => { fetchTables(); fetchPickups() }
    on('ORDER_CREATED', refresh)
    on('ORDER_UPDATED', refresh)
    on('ORDER_COMPLETED', refresh)
    on('ORDER_CANCELLED', refresh)
    on('ORDER_DELETED', refresh)
    on('TABLE_UPDATED', refresh)
    on('TABLE_CREATED', refresh)
    on('TABLE_DELETED', refresh)
    return () => {
      off('ORDER_CREATED'); off('ORDER_UPDATED'); off('ORDER_COMPLETED')
      off('ORDER_CANCELLED'); off('ORDER_DELETED')
      off('TABLE_UPDATED'); off('TABLE_CREATED'); off('TABLE_DELETED')
    }
  }, [on, off, fetchTables, fetchPickups])

  const stats = useMemo(() => {
    const occupied = tables.filter((t) => getOccupancy(t) === 'occupied').length
    const ready = tables.filter((t) => getOccupancy(t) === 'ready').length
    const free = tables.filter((t) => getOccupancy(t) === 'free').length
    const openRevenue =
      tables.reduce((s, t) => s + openOrders(t).reduce((a, o) => a + payable(o.total_amount || 0), 0), 0) +
      pickups.reduce((s, p) => s + payable(p.total_amount || 0), 0)
    return { total: tables.length, occupied, ready, free, openRevenue }
  }, [tables, pickups, payable])

  // Tap handler — free table → new order; READY table → bill screen; occupied → panel
  const handleTableTap = (t: TableWithStatus) => {
    if (manageMode) {
      setEditing(t); setFormOpen(true); return
    }
    const orders = openOrders(t)
    if (orders.length === 0) {
      setNewGuestOrder(false)
      setOrderForTable(t)
    } else if (orders.length === 1 && orders[0].status === 'READY') {
      // Open bill screen first — waiter shows bill, then collects payment
      setBillOrderId(orders[0].id)
      setBillTableNumber(t.table_number)
      setPanelTable(t) // keep panel reference for post-payment cleanup
    } else {
      // One or more guests: open the drawer (with a tab per guest when there are several)
      setPanelOrderId(orders[orders.length - 1].id)
      setPanelTable(t)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this table?')) return
    try {
      await api.delete(`/tables/${id}`)
      setTables((p) => p.filter((t) => t.id !== id))
      toast.success('Table deleted')
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  if (loading) return <Loading text="Loading floor…" />

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Floor</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Tap a table to take or manage an order
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button
              variant={manageMode ? 'primary' : 'outline'}
              leftIcon={<Cog6ToothIcon className="w-4 h-4" />}
              onClick={() => setManageMode((m) => !m)}
            >
              {manageMode ? 'Done' : 'Manage'}
            </Button>
            <Button
              variant="primary"
              leftIcon={<PlusIcon className="w-4 h-4" />}
              onClick={() => { setEditing(undefined); setFormOpen(true) }}
            >
              Add Table
            </Button>
          </div>
        )}
      </div>

      {/* Occupancy stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Free', value: stats.free, color: 'text-emerald-600' },
          { label: 'Occupied', value: stats.occupied, color: 'text-blue-600' },
          { label: 'Ready to pay', value: stats.ready, color: 'text-amber-600' },
          { label: 'Open revenue', value: `₹${stats.openRevenue.toFixed(2)}`, color: 'text-gray-900' },
        ].map((s) => (
          <Card key={s.label} padding="sm">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Free</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Occupied</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Ready to pay</span>
        {manageMode && <span className="text-indigo-600 font-medium ml-auto">Manage mode: tap a table to edit</span>}
      </div>

      {/* Floor grid */}
      {tables.length === 0 ? (
        <Card>
          <EmptyState
            icon={<TableCellsIcon className="w-7 h-7" />}
            title="No tables yet"
            description={isAdmin ? 'Add tables to start managing your floor.' : 'Ask an admin to set up tables.'}
            action={isAdmin ? { label: 'Add Table', onClick: () => { setEditing(undefined); setFormOpen(true) } } : undefined}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {tables.map((table) => {
            const occ = getOccupancy(table)
            const style = occupancyStyles[occ]
            const inactive = !table.is_active
            return (
              <div key={table.id} className="relative">
                <button
                  onClick={() => handleTableTap(table)}
                  disabled={inactive && !manageMode}
                  className={`w-full text-left bg-white border rounded-2xl p-4 transition-all hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed ${style.ring}`}
                >
                  {/* Status dot */}
                  <span className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full ${style.dot}`} />

                  {/* Table number */}
                  <p className="text-2xl font-bold text-gray-900">{table.table_number}</p>
                  <p className="text-xs text-gray-400">{table.seats} seats</p>

                  {/* Occupancy detail */}
                  <div className={`mt-3 inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${style.badge}`}>
                    {style.label}
                  </div>

                  {openOrders(table).length > 0 && (() => {
                    const orders = openOrders(table)
                    const total = orders.reduce((s, o) => s + payable(o.total_amount), 0)
                    const itemCount = orders.reduce((s, o) => s + (o.item_count || 0), 0)
                    return (
                      <div className="mt-2 space-y-0.5">
                        <p className="text-sm font-bold text-gray-900">₹{total.toFixed(2)}</p>
                        <p className="text-xs text-gray-400">
                          {itemCount} item{itemCount !== 1 ? 's' : ''} ·{' '}
                          {orders.length > 1
                            ? `${orders.length} orders (${orders.map((o) => o.guest_label || o.order_number.slice(-4)).join(', ')})`
                            : orders[0].order_number.slice(-4)}
                        </p>
                      </div>
                    )
                  })()}
                </button>

                {/* Manage-mode delete (admin) — sibling so we don't nest buttons */}
                {manageMode && (
                  <button
                    onClick={() => handleDelete(table.id)}
                    className="absolute bottom-2 right-2 p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete table"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pick-up orders — open parcel orders (no table), managed from here */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <ShoppingBagIcon className="w-5 h-5 text-indigo-600" />
            Pick-up orders
            <span className="text-sm font-normal text-gray-400">({pickups.length} open)</span>
          </h2>
          <Button variant="outline" leftIcon={<PlusIcon className="w-4 h-4" />} onClick={() => setNewPickup(true)}>
            New pick-up
          </Button>
        </div>

        {pickups.length === 0 ? (
          <Card padding="sm">
            <p className="text-sm text-gray-400 text-center py-3">No open pick-up orders</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {pickups.map((p) => {
              const st = PICKUP_STATUS[p.status] || { label: p.status, badge: 'bg-gray-100 text-gray-700' }
              const ready = p.status === 'READY'
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    if (ready) { setBillOrderId(p.id); setBillTableNumber(undefined); setPickupPanel(p) }
                    else setPickupPanel(p)
                  }}
                  className={`text-left bg-white border rounded-2xl p-4 transition-all hover:shadow-md ${
                    ready ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-gray-200 hover:border-indigo-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-lg font-bold text-gray-900">#{p.order_number.slice(-4)}</p>
                    <span className="text-xs text-gray-400">{formatRelative(p.created_at)}</span>
                  </div>
                  {p.guest_label && <p className="text-xs text-gray-500 mt-0.5 truncate">{p.guest_label}</p>}
                  <div className={`mt-2 inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${st.badge}`}>{st.label}</div>
                  <div className="mt-2 space-y-0.5">
                    <p className="text-sm font-bold text-gray-900">₹{payable(p.total_amount).toFixed(2)}</p>
                    <p className="text-xs text-gray-400">{p.item_count} item{p.item_count !== 1 ? 's' : ''}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Admin: create/edit table */}
      {formOpen && (
        <TableForm
          table={editing}
          onClose={() => setFormOpen(false)}
          onSave={() => { setFormOpen(false); fetchTables() }}
        />
      )}

      {/* New order / add items POS for a tapped table */}
      {orderForTable && (
        <OrderForm
          initialTableId={orderForTable.id}
          startNewOrder={newGuestOrder}
          guestLabel={newGuestOrder ? nextGuestLabel(openOrders(orderForTable)) : undefined}
          onClose={() => { setOrderForTable(null); setNewGuestOrder(false) }}
          onSave={() => { setOrderForTable(null); setNewGuestOrder(false); fetchTables() }}
        />
      )}

      {/* Occupied table management drawer — hide when bill screen is open.
          Several guests on one table get a tab each (Guest A, Guest B …). */}
      {panelTable && !billOrderId && !addItemsOrder && (() => {
        const orders = openOrders(panelTable)
        const selected = orders.find((o) => o.id === panelOrderId) || orders[orders.length - 1]
        if (!selected) return null
        return (
          <TableOrderPanel
            tableNumber={panelTable.table_number}
            orderId={selected.id}
            orders={orders.map((o) => ({
              id: o.id,
              label: orderName(o),
              amount: `₹${payable(o.total_amount).toFixed(0)}`,
              status: o.status,
            }))}
            onSelectOrder={(id) => setPanelOrderId(id)}
            onNewOrder={() => {
              const t = panelTable
              setPanelTable(null)
              setNewGuestOrder(true)
              setOrderForTable(t)
            }}
            refreshKey={panelRefresh}
            onClose={() => setPanelTable(null)}
            onChanged={() => fetchTables()}
            onAddItems={() => setAddItemsOrder({ id: selected.id, order_number: selected.order_number })}
            onCollectPayment={() => {
              setBillOrderId(selected.id)
              setBillTableNumber(panelTable.table_number)
            }}
          />
        )
      })()}

      {/* Add items to ONE guest's order on a table */}
      {addItemsOrder && (
        <AddItemsModal
          orderId={addItemsOrder.id}
          orderNumber={addItemsOrder.order_number}
          onClose={() => setAddItemsOrder(null)}
          onAdded={() => { setAddItemsOrder(null); setPanelRefresh((k) => k + 1); fetchTables() }}
        />
      )}

      {/* New pick-up order */}
      {newPickup && (
        <OrderForm
          initialOrderType="PARCEL"
          onClose={() => setNewPickup(false)}
          onSave={() => { setNewPickup(false); fetchPickups() }}
        />
      )}

      {/* Pick-up order drawer (same actions as a table: items, KOT, bill, payment) */}
      {pickupPanel && !billOrderId && !addItemsFor && (
        <TableOrderPanel
          tableNumber={`#${pickupPanel.order_number.slice(-4)}`}
          kindLabel="Pick-up order"
          orderId={pickupPanel.id}
          refreshKey={panelRefresh}
          onClose={() => setPickupPanel(null)}
          onChanged={() => fetchPickups()}
          onAddItems={() => setAddItemsFor(pickupPanel)}
          onCollectPayment={() => { setBillOrderId(pickupPanel.id); setBillTableNumber(undefined) }}
        />
      )}

      {addItemsFor && (
        <AddItemsModal
          orderId={addItemsFor.id}
          orderNumber={addItemsFor.order_number}
          onClose={() => setAddItemsFor(null)}
          onAdded={() => { setAddItemsFor(null); setPanelRefresh((k) => k + 1); fetchPickups() }}
        />
      )}

      {/* Bill screen — shown for READY orders before payment */}
      {billOrderId && (
        <BillScreen
          orderId={billOrderId}
          tableNumber={billTableNumber}
          onClose={() => {
            setBillOrderId(null)
            setBillTableNumber(undefined)
            setPickupPanel(null)
          }}
          onCompleted={() => {
            setBillOrderId(null)
            setBillTableNumber(undefined)
            setPickupPanel(null)
            setPanelRefresh((k) => k + 1)
            // fetchTables closes the table drawer when nobody is left on it, and keeps it open
            // (on the remaining guests) when other guests still have open orders
            fetchTables()
            fetchPickups()
          }}
        />
      )}

      {/* Legacy payment form — for non-READY manual payment from panel */}
      {payOrderId && (
        <PaymentForm
          orderId={payOrderId}
          onClose={() => setPayOrderId(null)}
          onPaymentSuccess={async () => {
            setPayOrderId(null)
            toast.success('Payment recorded')
            try {
              await api.patch(`/orders/${payOrderId}`, { status: 'COMPLETED' })
            } catch { /* ignore — payment already recorded */ }
            setPanelRefresh((k) => k + 1)
            fetchTables()
          }}
        />
      )}
    </div>
  )
}

export default Tables
