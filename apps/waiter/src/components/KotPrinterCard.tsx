import { useState } from 'react'
import toast from 'react-hot-toast'
import {
  checkPrinter,
  getKotPrefs,
  isWifiPrintingAvailable,
  printTestSlip,
  saveKotPrefs,
  sweepPendingKots,
  type KotPrefs,
} from '../lib/kotPrinter'

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({ on, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={`shrink-0 w-12 h-7 rounded-full transition-colors relative disabled:opacity-40 ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}
  >
    <span className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
  </button>
)

/** Profile card: connect the waiter app to a WiFi KOT printer and choose when to auto-print. */
const KotPrinterCard: React.FC = () => {
  const [prefs, setPrefs] = useState<KotPrefs>(getKotPrefs())
  const [host, setHost] = useState(prefs.host)
  const [port, setPort] = useState(String(prefs.port))
  const [busy, setBusy] = useState<'connect' | 'test' | null>(null)
  const supported = isWifiPrintingAvailable()
  const ready = supported && !!prefs.host

  const update = (patch: Partial<KotPrefs>) => setPrefs(saveKotPrefs(patch))

  const connect = async () => {
    setBusy('connect')
    try {
      const portNum = parseInt(port, 10) || 9100
      await checkPrinter(host, portNum)
      update({ host: host.trim(), port: portNum })
      toast.success('Printer connected')
    } catch (e: any) {
      toast.error(e?.message || 'Could not connect')
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('test')
    try {
      await printTestSlip()
      toast.success('Test slip sent')
    } catch (e: any) {
      toast.error(e?.message || 'Test failed')
    } finally {
      setBusy(null)
    }
  }

  const setStation = (on: boolean) => {
    update({ station: on })
    if (on) sweepPendingKots().catch(() => {})
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
      <div>
        <p className="font-semibold text-gray-900 text-sm">Kitchen printer (WiFi)</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Print kitchen tickets (KOT) on a thermal printer on the restaurant WiFi — no kitchen display needed.
        </p>
      </div>

      {!supported && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
          WiFi printing works only in the <b>AuraOS Waiter Android app</b>. A browser can't talk to a WiFi printer.
          Install the app on this phone, then open this screen again.
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-600">Printer IP address</label>
        <div className="flex gap-2">
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            inputMode="decimal"
            placeholder="192.168.1.50"
            disabled={!supported}
            className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-xl disabled:bg-gray-50"
          />
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            aria-label="Port"
            disabled={!supported}
            className="w-20 px-3 py-2 text-sm border border-gray-200 rounded-xl disabled:bg-gray-50"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={connect}
            disabled={!supported || !host.trim() || busy !== null}
            className="flex-1 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white disabled:opacity-50"
          >
            {busy === 'connect' ? 'Checking…' : ready ? 'Re-check & save' : 'Connect'}
          </button>
          <button
            onClick={test}
            disabled={!ready || busy !== null}
            className="flex-1 py-2 text-xs font-semibold rounded-xl border border-gray-200 text-gray-700 disabled:opacity-50"
          >
            {busy === 'test' ? 'Printing…' : 'Test print'}
          </button>
        </div>
        {ready && <p className="text-xs text-emerald-700">● Saved: {prefs.host}:{prefs.port}</p>}
      </div>

      <div className="flex gap-2 text-xs">
        <label className="flex-1">
          <span className="text-gray-600 font-medium">Paper</span>
          <select
            value={prefs.paperInches}
            onChange={(e) => update({ paperInches: e.target.value === '2' ? 2 : 3 })}
            className="mt-1 w-full px-2 py-2 border border-gray-200 rounded-xl bg-white"
          >
            <option value="3">80 mm (3 inch)</option>
            <option value="2">58 mm (2 inch)</option>
          </select>
        </label>
        <label className="flex-1">
          <span className="text-gray-600 font-medium">Auto cutter</span>
          <select
            value={prefs.autoCutter ? 'y' : 'n'}
            onChange={(e) => update({ autoCutter: e.target.value === 'y' })}
            className="mt-1 w-full px-2 py-2 border border-gray-200 rounded-xl bg-white"
          >
            <option value="y">Yes</option>
            <option value="n">No</option>
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">Auto-print when I place an order</p>
          <p className="text-xs text-gray-500">The KOT prints the moment you confirm an order or add items.</p>
        </div>
        <Toggle on={prefs.autoPrintMine} onChange={(v) => update({ autoPrintMine: v })} disabled={!ready} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">Kitchen printer station</p>
          <p className="text-xs text-gray-500">
            This device prints <b>every</b> new order (all waiters, QR orders once accepted). Turn on for ONE device
            near the kitchen; keep the app open and the phone charging.
          </p>
        </div>
        <Toggle on={prefs.station} onChange={setStation} disabled={!ready} />
      </div>
    </div>
  )
}

export default KotPrinterCard
