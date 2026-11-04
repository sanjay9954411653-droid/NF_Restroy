import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import { formatCurrency } from '../lib/utils'
import Card from './Card'
import ExportButtons from './ExportButtons'
import { ReportTable } from '../lib/exportReport'

interface ModeRow {
  method: 'CASH' | 'UPI' | 'CARD' | 'ONLINE'
  paid_amount: number
  paid_count: number
  refunded_amount: number
  pending_amount: number
}

interface ModeReport {
  from: string
  to: string
  modes: ModeRow[]
  total_paid: number
  total_paid_count: number
  total_refunded: number
  total_pending: number
}

const MODE_META: Record<string, { label: string; icon: string; bar: string }> = {
  CASH:   { label: 'Cash',   icon: '💵', bar: 'bg-emerald-500' },
  UPI:    { label: 'UPI',    icon: '📱', bar: 'bg-indigo-500' },
  CARD:   { label: 'Card',   icon: '💳', bar: 'bg-amber-500' },
  ONLINE: { label: 'Online', icon: '🌐', bar: 'bg-sky-500' },
}

type RangeKey = 'today' | 'yesterday' | '7d' | 'month' | 'custom'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
]

// YYYY-MM-DD for a Date, using the browser's local calendar day (not UTC)
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
    case 'month':     return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: day(0) }
    default:          return { from: day(0), to: day(0) }
  }
}

const PaymentModeReport: React.FC = () => {
  const [range, setRange] = useState<RangeKey>('today')
  const [customFrom, setCustomFrom] = useState(ymd(new Date()))
  const [customTo, setCustomTo] = useState(ymd(new Date()))
  const [report, setReport] = useState<ModeReport | null>(null)
  const [loading, setLoading] = useState(true)
  const latest = useRef(0)

  const load = useCallback(async () => {
    const { from, to } = range === 'custom' ? { from: customFrom, to: customTo } : rangeDates(range)
    if (!from || !to) return
    if (from > to) {
      toast.error('"From" date must not be after "To" date')
      return
    }
    const ticket = ++latest.current
    setLoading(true)
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const offset = -new Date().getTimezoneOffset() // minutes east of UTC (330 for India)
      const res = await api.get('/reports/payment-modes', { params: { from, to, tz, offset } })
      if (ticket === latest.current) setReport(res.data.data)
    } catch (err) {
      if (ticket === latest.current) toast.error(getErrorMessage(err))
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [range, customFrom, customTo])

  useEffect(() => { load() }, [load])

  const total = report?.total_paid || 0

  const periodText = report ? (report.from === report.to ? report.from : `${report.from} to ${report.to}`) : ''
  const buildTables = (): ReportTable[] => {
    if (!report) return []
    return [
      {
        name: 'Collections by payment mode',
        note: `Period: ${periodText} · only paid payments are counted as received`,
        headers: ['Mode', 'Paid payments', 'Total received', 'Share %', 'Refunded', 'Pending'],
        rows: report.modes.map((m) => [
          MODE_META[m.method].label,
          m.paid_count,
          m.paid_amount,
          total > 0 ? Math.round((m.paid_amount / total) * 1000) / 10 : 0,
          m.refunded_amount,
          m.pending_amount,
        ]),
        totals: ['Total', report.total_paid_count, report.total_paid, total > 0 ? 100 : 0, report.total_refunded, report.total_pending],
        money: [2, 4, 5],
      },
    ]
  }

  return (
    <Card>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
        <div>
          <h2 className="font-semibold text-gray-900">Collections by payment mode</h2>
          <p className="text-xs text-gray-400 mt-0.5">Money received (paid payments) in the selected period</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons
            title="Collections by payment mode"
            subtitle={`Period: ${periodText}`}
            filename="collections-by-payment-mode"
            getTables={buildTables}
            disabled={!report || loading}
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
        <div className="rounded-2xl bg-slate-900 text-white p-5 mb-4">
          <p className="text-sm text-slate-300">Total received</p>
          <p className="text-3xl font-bold mt-1">{formatCurrency(total)}</p>
          <p className="text-xs text-slate-400 mt-1">
            {report?.total_paid_count || 0} paid payment{report?.total_paid_count === 1 ? '' : 's'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {(report?.modes || []).map((m) => {
            const meta = MODE_META[m.method]
            const share = total > 0 ? (m.paid_amount / total) * 100 : 0
            return (
              <div key={m.method} className="rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <span className="text-lg">{meta.icon}</span>
                    {meta.label}
                  </span>
                  <span className="text-xs text-gray-400">{share.toFixed(0)}%</span>
                </div>
                <p className="text-xl font-bold text-gray-900 mt-2">{formatCurrency(m.paid_amount)}</p>
                <p className="text-xs text-gray-400">
                  {m.paid_count} payment{m.paid_count === 1 ? '' : 's'}
                </p>
                <div className="h-1.5 rounded-full bg-gray-100 mt-3 overflow-hidden">
                  <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${share}%` }} />
                </div>
              </div>
            )
          })}
        </div>

        {report && (report.total_refunded > 0 || report.total_pending > 0) && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-xs text-gray-500">
            {report.total_refunded > 0 && (
              <span>Refunded in this period: <b className="text-purple-700">{formatCurrency(report.total_refunded)}</b> (not counted above)</span>
            )}
            {report.total_pending > 0 && (
              <span>Pending, not yet collected: <b className="text-amber-700">{formatCurrency(report.total_pending)}</b></span>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

export default PaymentModeReport
