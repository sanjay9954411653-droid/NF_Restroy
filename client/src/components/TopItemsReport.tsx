import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, PieChart, Pie, Cell, Legend, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import api, { getErrorMessage } from '../api'
import { formatCurrency } from '../lib/utils'
import { formatWeight } from '../lib/weight'
import { RangeKey, rangeDates, ymd } from '../lib/dateRange'
import Card from './Card'
import ExportButtons from './ExportButtons'
import { ReportTable } from '../lib/exportReport'

interface TopItem {
  menu_item_id: string
  name: string
  total_quantity: number
  total_revenue: number
  total_weight_grams: number
  tables?: { table_id: string | null; table_name: string; quantity: number; orders: number }[]
}

const tableLabel = (t: { table_name: string }) => (t.table_name === 'No table' ? 'No table' : `Table ${t.table_name}`)
const tablesText = (it: TopItem) =>
  (it.tables || []).map((t) => `${tableLabel(t)} ×${t.quantity}`).join(', ')

type SortKey = 'quantity' | 'revenue'

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981']

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
]

const TopItemsReport: React.FC = () => {
  const [range, setRange] = useState<RangeKey>('7d')
  const [sort, setSort] = useState<SortKey>('quantity')
  const [customFrom, setCustomFrom] = useState(ymd(new Date()))
  const [customTo, setCustomTo] = useState(ymd(new Date()))
  const [items, setItems] = useState<TopItem[]>([])
  const [periodText, setPeriodText] = useState('All time')
  const [loading, setLoading] = useState(true)
  const latest = useRef(0)

  const load = useCallback(async () => {
    const params: Record<string, string | number> = { limit: 10, sort, by_table: 1 }
    let label = 'All time'
    if (range !== 'all') {
      const { from, to } = range === 'custom' ? { from: customFrom, to: customTo } : rangeDates(range)
      if (!from || !to) return
      if (from > to) {
        toast.error('"From" date must not be after "To" date')
        return
      }
      params.from = from
      params.to = to
      label = from === to ? from : `${from} to ${to}`
      params.tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      params.offset = -new Date().getTimezoneOffset()
    }
    const ticket = ++latest.current
    setLoading(true)
    try {
      const res = await api.get('/reports/top-items', { params })
      if (ticket === latest.current) {
        setItems(res.data.data || [])
        setPeriodText(label)
      }
    } catch (err) {
      if (ticket === latest.current) toast.error(getErrorMessage(err))
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [range, sort, customFrom, customTo])

  useEffect(() => { load() }, [load])

  const metric = sort === 'revenue' ? 'total_revenue' : 'total_quantity'
  const fmtMetric = (v: number) => (sort === 'revenue' ? formatCurrency(v) : `${v} sold`)
  const chartData = items.slice(0, 8)
  const pieData = items.slice(0, 5).map((i) => ({ name: i.name, value: Number(i[metric]) }))
  const totalSold = items.reduce((s, i) => s + i.total_quantity, 0)
  const totalRevenue = items.reduce((s, i) => s + i.total_revenue, 0)

  const buildTables = (): ReportTable[] => [
    {
      name: 'Top selling items',
      note: `Period: ${periodText} · ranked by ${sort === 'revenue' ? 'revenue' : 'quantity'} · cancelled orders not counted`,
      headers: ['#', 'Item', 'Quantity sold', 'Weight sold', 'Revenue', 'Ordered from tables'],
      rows: items.map((it, i) => [
        i + 1,
        it.name,
        it.total_quantity,
        it.total_weight_grams > 0 ? formatWeight(it.total_weight_grams) : '',
        it.total_revenue,
        tablesText(it),
      ]),
      totals: ['', `Top ${items.length} items`, totalSold, '', totalRevenue, ''],
      money: [4],
    },
  ]

  return (
    <Card>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
        <div>
          <h2 className="font-semibold text-gray-900">Top selling items</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Best sellers in the selected period (cancelled orders are not counted)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 self-start lg:self-auto">
        <ExportButtons
          title="Top selling items"
          subtitle={`Period: ${periodText}`}
          filename="top-selling-items"
          getTables={buildTables}
          disabled={items.length === 0 || loading}
        />
        <div className="flex rounded-lg bg-gray-100 p-0.5">
          {([['quantity', 'By quantity'], ['revenue', 'By revenue']] as [SortKey, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                sort === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
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

      {range === 'custom' && (
        <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
          <label className="flex items-center gap-2 text-gray-600">
            From
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-gray-600">
            To
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
            />
          </label>
        </div>
      )}

      <div className={`transition-opacity ${loading ? 'opacity-50' : ''}`}>
        {items.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">
            {loading ? 'Loading…' : 'No sales in this period'}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#374151' }}
                    axisLine={false}
                    tickLine={false}
                    width={100}
                  />
                  <Tooltip
                    formatter={(v: any) => [fmtMetric(Number(v)), sort === 'revenue' ? 'Revenue' : 'Quantity']}
                    contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}
                  />
                  <Bar dataKey={metric} radius={[0, 4, 4, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value">
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: any) => [fmtMetric(Number(v)), '']}
                    contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(v) => <span className="text-xs text-gray-600">{v}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto mt-6">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th className="text-right">Sold</th>
                    <th className="text-right">Revenue</th>
                    <th>Ordered from tables</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={it.menu_item_id}>
                      <td className="text-gray-400">{i + 1}</td>
                      <td className="font-medium text-gray-900">{it.name}</td>
                      <td className="text-right">
                        {it.total_weight_grams > 0 ? (
                          <>
                            {formatWeight(it.total_weight_grams)}
                            <span className="text-xs text-gray-400"> ({it.total_quantity} orders)</span>
                          </>
                        ) : (
                          it.total_quantity
                        )}
                      </td>
                      <td className="text-right font-semibold">{formatCurrency(it.total_revenue)}</td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          {(it.tables || []).slice(0, 5).map((t) => (
                            <span
                              key={t.table_id ?? 'none'}
                              title={`${t.quantity} sold in ${t.orders} order${t.orders === 1 ? '' : 's'}`}
                              className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium"
                            >
                              {t.table_name === 'No table' ? 'No table' : `T${t.table_name}`} · {t.quantity}
                            </span>
                          ))}
                          {(it.tables || []).length > 5 && (
                            <span className="text-xs text-gray-400 self-center">+{(it.tables || []).length - 5} more</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td />
                    <td className="text-xs text-gray-400">Top {items.length} items</td>
                    <td className="text-right text-xs text-gray-500">{totalSold}</td>
                    <td className="text-right text-xs font-semibold text-gray-700">{formatCurrency(totalRevenue)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

export default TopItemsReport
