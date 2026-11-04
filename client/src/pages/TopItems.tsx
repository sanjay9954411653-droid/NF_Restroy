import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import { formatCurrency } from '../lib/utils'
import { downloadPdf, downloadXlsx } from '../lib/exportReport'
import type { ExportTable } from '../lib/exportReport'
import Card from '../components/Card'
import Loading from '../components/Loading'

interface TopItem {
  menu_item_id: string
  name: string
  total_quantity: number
  total_revenue: number
}

type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'custom'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom' },
]

// YYYY-MM-DD in the browser's local calendar (not UTC)
const ymd = (d: Date) => d.toLocaleDateString('en-CA')

function rangeDates(key: RangeKey): { from: string; to: string } {
  const now = new Date()
  const day = (offset: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + offset)
    return ymd(d)
  }
  switch (key) {
    case 'yesterday': return { from: day(-1), to: day(-1) }
    case '7d':        return { from: day(-6), to: day(0) }
    case '30d':       return { from: day(-29), to: day(0) }
    default:          return { from: day(0), to: day(0) }
  }
}

const prettyDate = (s: string) =>
  new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

const TopItems: React.FC = () => {
  const [range, setRange] = useState<RangeKey>('today')
  const [customFrom, setCustomFrom] = useState(ymd(new Date()))
  const [customTo, setCustomTo] = useState(ymd(new Date()))
  const [items, setItems] = useState<TopItem[]>([])
  const [loading, setLoading] = useState(true)
  const latest = useRef(0)

  const { from, to } = range === 'custom' ? { from: customFrom, to: customTo } : rangeDates(range)

  const load = useCallback(async () => {
    const f = range === 'custom' ? customFrom : rangeDates(range).from
    const t = range === 'custom' ? customTo : rangeDates(range).to
    if (!f || !t) return
    if (f > t) {
      toast.error('"From" date must not be after "To" date')
      return
    }
    const ticket = ++latest.current
    setLoading(true)
    try {
      const res = await api.get('/reports/top-items', { params: { from: f, to: t, limit: 500 } })
      if (ticket === latest.current) setItems(res.data.data || [])
    } catch (err) {
      if (ticket === latest.current) toast.error(getErrorMessage(err))
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [range, customFrom, customTo])

  useEffect(() => { load() }, [load])

  const totalQty = items.reduce((s, i) => s + i.total_quantity, 0)
  const totalSales = items.reduce((s, i) => s + i.total_revenue, 0)
  const periodLabel = from === to ? prettyDate(from) : `${prettyDate(from)} to ${prettyDate(to)}`

  const buildTable = (): ExportTable => ({
    fileName: `top-items_${from}_to_${to}`,
    title: 'Top Items',
    subtitle: `Period: ${periodLabel} · by quantity sold`,
    headers: ['#', 'Item', 'Qty sold', 'Sales (₹)'],
    rows: items.map((i, idx) => [idx + 1, i.name, i.total_quantity, i.total_revenue]),
    totals: ['', 'Total', totalQty, totalSales],
    moneyCols: [3],
  })

  const handleExport = (kind: 'xlsx' | 'pdf') => {
    if (items.length === 0) {
      toast.error('Nothing to export for this period')
      return
    }
    try {
      if (kind === 'xlsx') downloadXlsx(buildTable())
      else downloadPdf(buildTable())
    } catch (err) {
      toast.error('Export failed. Please try again.')
      console.error(err)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <Link to="/dashboard" className="text-xs font-medium text-brand-600 hover:underline">← Back to dashboard</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Top Items</h1>
          <p className="text-sm text-gray-500 mt-0.5">{periodLabel} · by quantity sold</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('xlsx')}
            disabled={loading || items.length === 0}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Export Excel
          </button>
          <button
            onClick={() => handleExport('pdf')}
            disabled={loading || items.length === 0}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Export PDF
          </button>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap gap-2">
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
          <div className="flex flex-wrap items-center gap-3 mt-4 text-sm">
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
      </Card>

      {loading && items.length === 0 ? (
        <Loading text="Loading items…" />
      ) : (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <p className="text-sm text-gray-500">Items sold</p>
              <p className="text-2xl font-bold text-gray-900">{totalQty}</p>
            </Card>
            <Card>
              <p className="text-sm text-gray-500">Item sales</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalSales)}</p>
              <p className="text-xs text-gray-400 mt-0.5">Before GST and charges</p>
            </Card>
          </div>

          <Card padding="none">
            {items.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
                No items sold in this period
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Item</th>
                      <th className="text-right">Qty sold</th>
                      <th className="text-right">Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={item.menu_item_id}>
                        <td className="text-gray-400">{i + 1}</td>
                        <td className="font-medium">{item.name}</td>
                        <td className="text-right">{item.total_quantity}</td>
                        <td className="text-right font-semibold">{formatCurrency(item.total_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

export default TopItems
