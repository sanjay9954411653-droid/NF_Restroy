import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, PieChart, Pie, Cell, Legend, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import api, { getErrorMessage } from '../api'
import { formatCurrency } from '../lib/utils'
import { RangeKey, rangeDates, ymd } from '../lib/dateRange'
import Card from './Card'
import ExportButtons from './ExportButtons'
import { ReportTable } from '../lib/exportReport'

interface Row { key: string; orders: number; amount: number }
interface StaffRow { user_id: string | null; name: string; role: string | null; orders: number; amount: number }
interface Breakdown {
  from: string
  to: string
  total_orders: number
  total_amount: number
  by_source: Row[]
  by_type: Row[]
  by_staff: StaffRow[]
}

const SOURCE_LABEL: Record<string, string> = {
  WAITER: 'Waiter / POS',
  RECEPTION: 'Reception',
  QR: 'Customer QR',
  WHATSAPP: 'WhatsApp',
  ZOMATO: 'Zomato',
}
const TYPE_LABEL: Record<string, string> = {
  DINE_IN: 'Dine-in',
  PARCEL: 'Parcel',
  ONLINE: 'Online / delivery',
}
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6']

const RANGES: { key: Exclude<RangeKey, 'all'>; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
]

const OrderBreakdownReport: React.FC<{ refreshKey?: number }> = ({ refreshKey = 0 }) => {
  const [range, setRange] = useState<Exclude<RangeKey, 'all'>>('today')
  const [customFrom, setCustomFrom] = useState(ymd(new Date()))
  const [customTo, setCustomTo] = useState(ymd(new Date()))
  const [data, setData] = useState<Breakdown | null>(null)
  const [loading, setLoading] = useState(true)
  const latest = useRef(0)

  const load = useCallback(async () => {
    const { from, to } =
      range === 'custom' ? { from: customFrom, to: customTo } : rangeDates(range as Exclude<RangeKey, 'all' | 'custom'>)
    if (!from || !to) return
    if (from > to) {
      toast.error('"From" date must not be after "To" date')
      return
    }
    const ticket = ++latest.current
    setLoading(true)
    try {
      const res = await api.get('/reports/order-breakdown', { params: { from, to } })
      if (ticket === latest.current) setData(res.data.data)
    } catch (err) {
      if (ticket === latest.current) toast.error(getErrorMessage(err))
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [range, customFrom, customTo, refreshKey])

  useEffect(() => { load() }, [load])

  const total = data?.total_orders || 0
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0)
  const sourceRows = (data?.by_source || []).map((r) => ({ ...r, label: SOURCE_LABEL[r.key] || r.key }))
  const typeRows = (data?.by_type || []).map((r) => ({ ...r, label: TYPE_LABEL[r.key] || r.key }))
  const staffRows = data?.by_staff || []
  const periodText = data ? (data.from === data.to ? data.from : `${data.from} to ${data.to}`) : ''

  const buildTables = (): ReportTable[] => {
    if (!data) return []
    return [
      {
        name: 'Orders by source',
        note: `Period: ${periodText} · cancelled orders not counted`,
        headers: ['Source', 'Orders', 'Share %', 'Order value'],
        rows: sourceRows.map((r) => [r.label, r.orders, pct(r.orders), r.amount]),
        totals: ['Total', data.total_orders, total > 0 ? 100 : 0, data.total_amount],
        money: [3],
      },
      {
        name: 'Orders by type',
        note: `Period: ${periodText}`,
        headers: ['Type', 'Orders', 'Share %', 'Order value'],
        rows: typeRows.map((r) => [r.label, r.orders, pct(r.orders), r.amount]),
        totals: ['Total', data.total_orders, total > 0 ? 100 : 0, data.total_amount],
        money: [3],
      },
      {
        name: 'Orders by staff',
        note: `Period: ${periodText} · "Customer / online" = orders placed without a staff login`,
        headers: ['Staff', 'Role', 'Orders', 'Share %', 'Order value', 'Avg order'],
        rows: staffRows.map((r) => [
          r.name, r.role || '', r.orders, pct(r.orders), r.amount, r.orders ? Math.round(r.amount / r.orders) : 0,
        ]),
        totals: ['Total', '', data.total_orders, total > 0 ? 100 : 0, data.total_amount, total ? Math.round(data.total_amount / total) : 0],
        money: [4, 5],
      },
    ]
  }

  return (
    <Card>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
        <div>
          <h2 className="font-semibold text-gray-900">Orders: where they came from & who took them</h2>
          <p className="text-xs text-gray-400 mt-0.5">Cancelled orders are not counted</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons
            title="Orders by source and staff"
            subtitle={`Period: ${periodText}`}
            filename="orders-by-source-and-staff"
            getTables={buildTables}
            disabled={!data || loading}
          />
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                range === r.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {range === 'custom' && (
        <div className="flex flex-wrap items-center gap-3 mb-5 text-sm">
          <label className="flex items-center gap-2 text-gray-600">
            From
            <input type="date" value={customFrom} max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-gray-600">
            To
            <input type="date" value={customTo} min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
          </label>
        </div>
      )}

      <div className={`transition-opacity ${loading ? 'opacity-50' : ''}`}>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-2xl bg-slate-900 text-white p-4">
            <p className="text-sm text-slate-300">Orders</p>
            <p className="text-2xl font-bold mt-1">{total}</p>
          </div>
          <div className="rounded-2xl bg-slate-900 text-white p-4">
            <p className="text-sm text-slate-300">Order value</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(data?.total_amount || 0)}</p>
          </div>
        </div>

        {total === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No orders in this period.</p>
        ) : (
          <>
            {/* Source cards */}
            <h3 className="text-sm font-semibold text-gray-700 mb-2">By source</h3>
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-6">
              {sourceRows.map((r, i) => (
                <div key={r.key} className="rounded-2xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">{r.label}</span>
                    <span className="text-xs text-gray-400">{pct(r.orders)}%</span>
                  </div>
                  <p className="text-xl font-bold text-gray-900 mt-2">{r.orders} orders</p>
                  <p className="text-xs text-gray-400">{formatCurrency(r.amount)}</p>
                  <div className="h-1.5 rounded-full bg-gray-100 mt-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct(r.orders)}%`, background: COLORS[i % COLORS.length] }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Source + type donut */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Source vs order type</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={sourceRows} dataKey="orders" nameKey="label" innerRadius={45} outerRadius={70}>
                      {sourceRows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Pie data={typeRows} dataKey="orders" nameKey="label" innerRadius={78} outerRadius={100}>
                      {typeRows.map((_, i) => <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${v} orders`} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 text-center">Inner ring: source · outer ring: dine-in / parcel / online</p>
              </div>

              {/* Staff chart */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Orders taken by staff</h3>
                <ResponsiveContainer width="100%" height={Math.max(200, staffRows.length * 42 + 40)}>
                  <BarChart data={staffRows} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(v: number, _n, p: any) => [`${v} orders · ${formatCurrency(p.payload.amount)}`, p.payload.name]}
                    />
                    <Bar dataKey="orders" radius={[0, 6, 6, 0]}>
                      {staffRows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Staff table */}
            <div className="overflow-x-auto mt-6">
              <table className="data-table">
                <thead>
                  <tr><th>Staff</th><th>Role</th><th>Orders</th><th>Share</th><th>Order value</th><th>Avg order</th></tr>
                </thead>
                <tbody>
                  {staffRows.map((r) => (
                    <tr key={r.user_id ?? 'customer'}>
                      <td className="font-medium">{r.name}</td>
                      <td className="text-gray-500">{r.role ? r.role.charAt(0) + r.role.slice(1).toLowerCase() : '—'}</td>
                      <td className="font-semibold">{r.orders}</td>
                      <td className="text-gray-500">{pct(r.orders)}%</td>
                      <td>{formatCurrency(r.amount)}</td>
                      <td className="text-gray-500">{formatCurrency(r.orders ? r.amount / r.orders : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

export default OrderBreakdownReport
