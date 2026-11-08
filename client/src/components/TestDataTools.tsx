/**
 * TestDataTools — super-admin panel for ONE restaurant:
 *   1. Demo / Training mode switch (new orders are flagged as test and left out of reports)
 *   2. Clear test data: choose what + how much, preview, optional backup, typed confirmation
 *   3. History of earlier clears
 * Shown inside the restaurant detail modal on the Owner dashboard.
 */
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import { formatCurrency, formatDate } from '../lib/utils'

type Mode = 'range' | 'before' | 'all' | 'test'
type Extra = 'loyalty' | 'reviews' | 'reservations' | 'table_requests' | 'inventory' | 'print_jobs'

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: 'range',  label: 'Date range',        hint: 'Orders placed between two dates' },
  { key: 'before', label: 'Before a date',     hint: 'Everything older than a date' },
  { key: 'test',   label: 'Demo-mode orders',  hint: 'Only orders placed while Demo mode was on' },
  { key: 'all',    label: 'Everything',        hint: 'Every order of this restaurant' },
]

const EXTRAS: { key: Extra; label: string; note?: string }[] = [
  { key: 'loyalty',        label: 'Loyalty points & coupon usage', note: 'earned points are taken back, coupon use counts go down' },
  { key: 'reviews',        label: 'Reviews left on these orders' },
  { key: 'reservations',   label: 'Reservations', note: 'by the date they were made' },
  { key: 'table_requests', label: 'Call-waiter / bill requests' },
  { key: 'inventory',      label: 'Inventory usage history', note: 'history only; stock levels are not changed' },
  { key: 'print_jobs',     label: 'Print job history' },
]

const EXTRA_COUNT_LABEL: Record<string, string> = {
  loyalty: 'loyalty entries', reviews: 'reviews', reservations: 'reservations',
  table_requests: 'table requests', inventory: 'inventory rows', print_jobs: 'print jobs',
}

const today = () => new Date().toISOString().slice(0, 10)

interface Preview {
  restaurant: { id: string; name: string; demo_mode: boolean }
  orders: number
  order_items: number
  payments: number
  paid_revenue: number
  order_value: number
  first_order_at: string | null
  last_order_at: string | null
  open_orders_skipped: number
  extras: Record<string, number>
  sample: { id: string; order_number: string; status: string; order_type: string; total_amount: number; is_test: boolean; created_at: string }[]
}

const TestDataTools: React.FC<{ restaurantId: string; restaurantName: string; demoMode: boolean; onDemoChange: (v: boolean) => void }> = ({
  restaurantId, restaurantName, demoMode, onDemoChange,
}) => {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('range')
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [before, setBefore] = useState(today())
  const [includeOpen, setIncludeOpen] = useState(false)
  const [extras, setExtras] = useState<Extra[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<any[]>([])

  const body = useCallback(() => ({
    mode,
    ...(mode === 'range' ? { from, to } : {}),
    ...(mode === 'before' ? { before } : {}),
    include_open: includeOpen,
    include: extras,
  }), [mode, from, to, before, includeOpen, extras])

  // Any change to the choices invalidates the preview, so a stale preview can never be confirmed
  useEffect(() => { setPreview(null); setConfirmName('') }, [mode, from, to, before, includeOpen, extras])

  const loadLog = useCallback(async () => {
    try {
      const r = await api.get(`/admin/restaurants/${restaurantId}/test-data/log`)
      setLog(r.data.data || [])
    } catch { /* history is optional */ }
  }, [restaurantId])

  useEffect(() => { if (open) loadLog() }, [open, loadLog])

  const toggleDemo = async () => {
    setBusy('demo')
    try {
      await api.put(`/admin/restaurants/${restaurantId}/demo-mode`, { enabled: !demoMode })
      onDemoChange(!demoMode)
      toast.success(!demoMode ? 'Demo mode ON — new orders are test orders' : 'Demo mode OFF')
    } catch (e) { toast.error(getErrorMessage(e)) }
    finally { setBusy(null) }
  }

  const runPreview = async () => {
    setBusy('preview')
    try {
      const r = await api.post(`/admin/restaurants/${restaurantId}/test-data/preview`, body())
      setPreview(r.data.data)
    } catch (e) { toast.error(getErrorMessage(e)) }
    finally { setBusy(null) }
  }

  const downloadBackup = async () => {
    setBusy('backup')
    try {
      const r = await api.post(`/admin/restaurants/${restaurantId}/test-data/backup`, body(), { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `orders-backup-${restaurantName.replace(/\W+/g, '-')}-${today()}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { toast.error(getErrorMessage(e)) }
    finally { setBusy(null) }
  }

  const clearNow = async () => {
    setBusy('clear')
    try {
      const r = await api.post(`/admin/restaurants/${restaurantId}/test-data/clear`, { ...body(), confirm_name: confirmName })
      const c = r.data.data.counts as Record<string, number>
      toast.success(`Cleared ${c.orders} orders${c.payments ? ` and ${c.payments} payments` : ''}`)
      setPreview(null)
      setConfirmName('')
      loadLog()
    } catch (e) { toast.error(getErrorMessage(e)) }
    finally { setBusy(null) }
  }

  const nameMatches = confirmName.trim().toLowerCase() === restaurantName.trim().toLowerCase()
  const nothing = preview && preview.orders === 0 && Object.values(preview.extras).every((n) => n === 0)

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/40 p-3 text-sm">
      {/* Demo mode */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-700">Demo / training mode</p>
          <p className="text-xs text-slate-500 mt-0.5">
            While ON, every new order and payment is marked as a test and left out of all reports.
            Use it for training or trying things out; clear them later with “Demo-mode orders” below.
          </p>
        </div>
        <button
          type="button"
          disabled={busy === 'demo'}
          onClick={toggleDemo}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold ${demoMode ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-700'}`}
        >
          {demoMode ? 'ON — turn off' : 'OFF — turn on'}
        </button>
      </div>

      <div className="border-t border-red-200 my-3" />

      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between text-left">
        <span className="font-semibold text-red-700">Clear test data</span>
        <span className="text-xs text-slate-500">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <p className="text-xs text-slate-500">
            Removes orders (with their items and payments) and, if you choose, related records for <b>{restaurantName}</b> only.
            Menu, tables, users, settings and billing are never touched.
          </p>

          {/* 1. Which orders */}
          <div>
            <p className="font-medium text-slate-700 mb-1.5">1. Which orders?</p>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key)}
                  className={`text-left rounded-lg border px-2.5 py-2 ${mode === m.key ? 'border-red-500 bg-white' : 'border-slate-200 bg-white/60'}`}
                >
                  <span className="block text-xs font-semibold text-slate-800">{m.label}</span>
                  <span className="block text-[11px] text-slate-500">{m.hint}</span>
                </button>
              ))}
            </div>
            {mode === 'range' && (
              <div className="flex flex-wrap gap-3 mt-2">
                <label className="text-xs text-slate-600">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="ml-1 rounded border border-slate-300 px-2 py-1" /></label>
                <label className="text-xs text-slate-600">To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="ml-1 rounded border border-slate-300 px-2 py-1" /></label>
              </div>
            )}
            {mode === 'before' && (
              <label className="block text-xs text-slate-600 mt-2">Orders placed before <input type="date" value={before} onChange={(e) => setBefore(e.target.value)} className="ml-1 rounded border border-slate-300 px-2 py-1" /></label>
            )}
            <label className="flex items-center gap-2 text-xs text-slate-600 mt-2">
              <input type="checkbox" checked={includeOpen} onChange={(e) => setIncludeOpen(e.target.checked)} />
              Also remove orders that are still open (not completed / cancelled)
            </label>
          </div>

          {/* 2. Extras */}
          <div>
            <p className="font-medium text-slate-700 mb-1.5">2. Also clear (optional)</p>
            <div className="space-y-1">
              {EXTRAS.map((x) => (
                <label key={x.key} className="flex items-start gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={extras.includes(x.key)}
                    onChange={(e) => setExtras((cur) => (e.target.checked ? [...cur, x.key] : cur.filter((k) => k !== x.key)))}
                  />
                  <span>{x.label}{x.note && <span className="text-slate-400"> — {x.note}</span>}</span>
                </label>
              ))}
            </div>
            {mode === 'test' && extras.some((k) => ['reservations', 'table_requests', 'inventory', 'print_jobs'].includes(k)) && (
              <p className="text-[11px] text-amber-600 mt-1">“Demo-mode orders” only clears orders and what is linked to them; date-based items are skipped.</p>
            )}
          </div>

          {/* 3. Preview */}
          <div>
            <button
              type="button"
              onClick={runPreview}
              disabled={busy === 'preview'}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold disabled:opacity-60"
            >
              {busy === 'preview' ? 'Checking…' : '3. Preview what will be removed'}
            </button>
          </div>

          {preview && (
            <div className="rounded-lg bg-white border border-slate-200 p-3 space-y-2">
              <p className="text-sm font-semibold text-slate-800">
                {preview.orders} orders · {preview.order_items} items · {preview.payments} payments
              </p>
              <p className="text-xs text-slate-600">
                Paid revenue that will leave the reports: <b>{formatCurrency(preview.paid_revenue)}</b>
                {preview.first_order_at && <> · {formatDate(preview.first_order_at)} to {formatDate(preview.last_order_at as string)}</>}
              </p>
              {Object.entries(preview.extras).length > 0 && (
                <p className="text-xs text-slate-600">
                  Also: {Object.entries(preview.extras).map(([k, n]) => `${n} ${EXTRA_COUNT_LABEL[k] || k}`).join(' · ')}
                </p>
              )}
              {preview.open_orders_skipped > 0 && (
                <p className="text-xs text-amber-600">
                  {preview.open_orders_skipped} open order(s) match but will be kept (tick “also remove open orders” to include them).
                </p>
              )}
              {preview.sample.length > 0 && (
                <div className="text-[11px] text-slate-500">
                  <p className="font-medium text-slate-600">Newest orders in this selection:</p>
                  {preview.sample.map((o) => (
                    <p key={o.id}>
                      #{o.order_number} · {formatDate(o.created_at)} · {formatCurrency(o.total_amount)} · {o.status}
                      {o.is_test && <span className="text-amber-600"> · test</span>}
                    </p>
                  ))}
                  {preview.orders > preview.sample.length && <p>…and {preview.orders - preview.sample.length} more</p>}
                </div>
              )}

              {nothing ? (
                <p className="text-xs text-slate-500">Nothing matches — nothing to clear.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={downloadBackup}
                      disabled={busy === 'backup' || preview.orders === 0}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 disabled:opacity-50"
                    >
                      {busy === 'backup' ? 'Preparing…' : '4. Download backup (JSON)'}
                    </button>
                    <span className="text-[11px] text-slate-400">Recommended — keeps a copy of the orders that will be deleted</span>
                  </div>
                  <div className="pt-1">
                    <label className="text-xs text-slate-600">
                      5. Type <b>{restaurantName}</b> to confirm
                      <input
                        value={confirmName}
                        onChange={(e) => setConfirmName(e.target.value)}
                        placeholder={restaurantName}
                        className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={clearNow}
                      disabled={!nameMatches || busy === 'clear'}
                      className="mt-2 px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold disabled:opacity-40"
                    >
                      {busy === 'clear' ? 'Deleting…' : 'Delete permanently'}
                    </button>
                    <p className="text-[11px] text-slate-400 mt-1">This cannot be undone. It runs all-or-nothing and is saved in the history below.</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* History */}
          {log.length > 0 && (
            <div>
              <p className="font-medium text-slate-700 mb-1">Earlier clears</p>
              <div className="space-y-1">
                {log.map((l) => (
                  <p key={l.id} className="text-[11px] text-slate-500 bg-white rounded px-2 py-1 border border-slate-200">
                    {formatDate(l.created_at)} · {l.performed_by} · {l.counts?.orders ?? 0} orders
                    {l.counts?.payments ? `, ${l.counts.payments} payments` : ''} · {l.filter?.mode}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TestDataTools
