/**
 * PrinterSettings — connect a thermal receipt printer to THIS device.
 *
 * Android (Chrome) + USB-OTG cable, or Windows/Mac Chrome/Edge: tap
 * "Discover", pick the printer, allow the permission, done. After that every
 * Print Bill / Print KOT button prints straight to the printer, no dialog.
 * Settings (paper size, auto cutter, UPI QR) are saved on this device.
 */
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { PrinterIcon } from '@heroicons/react/24/outline'
import Card from '../components/Card'
import Button from '../components/Button'
import { getPrinterPrefs, savePrinterPrefs, PrinterPrefs } from '../lib/printerSettings'
import {
  connectUSB,
  connectBluetooth,
  connectGrantedUsb,
  connectNetwork,
  getSavedNetworkPrinter,
  listGrantedUsb,
  ensurePrinterReconnected,
  getConnectedPrinter,
  getConnectedPrinterName,
  disconnectPrinter,
  printTest,
  isPrinterSupported,
} from '../lib/thermalPrinter'

function Choice<T extends string | number | boolean>({
  label, value, options, onChange,
}: {
  label: string
  value: T
  options: { label: string; value: T }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="flex rounded-lg overflow-hidden border border-slate-300">
        {options.map((o) => (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className={`px-4 py-1.5 text-sm ${value === o.value ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function PrinterSettings() {
  const [prefs, setPrefs] = useState<PrinterPrefs>(getPrinterPrefs())
  const [granted, setGranted] = useState<USBDevice[]>([])
  const [connectedName, setConnectedName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const support = isPrinterSupported()
  const savedNet = getSavedNetworkPrinter()
  const [netHost, setNetHost] = useState(savedNet?.host || '')
  const [netPort, setNetPort] = useState(String(savedNet?.port || 9100))

  const refresh = useCallback(async () => {
    await ensurePrinterReconnected()
    setGranted(await listGrantedUsb())
    setConnectedName(getConnectedPrinterName())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const update = (patch: Partial<PrinterPrefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    savePrinterPrefs(next)
  }

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
    } catch (err: any) {
      if (err?.name !== 'NotFoundError') toast.error(err?.message || 'Printer error')
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const connected = !!getConnectedPrinter()

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <Card padding="md">
        <div className="flex items-center gap-2 mb-1">
          <PrinterIcon className="w-6 h-6 text-slate-700" />
          <h1 className="text-lg font-semibold text-slate-900">Printer Settings</h1>
        </div>
        <p className={`text-sm mb-4 ${connected ? 'text-green-600' : 'text-slate-500'}`}>
          {connected ? `Connected: ${connectedName}` : 'Not connected'}
        </p>

        <div className="flex flex-wrap gap-2">
          {support.usb && (
            <Button isLoading={busy} onClick={() => run(connectUSB, 'USB printer connected')}>
              Discover (USB)
            </Button>
          )}
          {support.bluetooth && (
            <Button variant="outline" isLoading={busy} onClick={() => run(connectBluetooth, 'Bluetooth printer connected')}>
              Bluetooth (BLE only)
            </Button>
          )}
          {connected && (
            <>
              <Button variant="secondary" isLoading={busy} onClick={() => run(printTest, 'Test page sent')}>
                Test print
              </Button>
              <Button variant="ghost" onClick={() => { disconnectPrinter(); refresh() }}>
                Disconnect
              </Button>
            </>
          )}
        </div>

        {support.network && (
          <div className="mt-5 rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-700 mb-2">WiFi / LAN printer</p>
            <div className="flex gap-2">
              <input
                value={netHost}
                onChange={(e) => setNetHost(e.target.value)}
                placeholder="Printer IP, e.g. 192.168.1.50"
                inputMode="decimal"
                className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                value={netPort}
                onChange={(e) => setNetPort(e.target.value.replace(/\D/g, ''))}
                placeholder="9100"
                inputMode="numeric"
                className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <Button
              className="mt-2"
              isLoading={busy}
              onClick={() => run(() => connectNetwork(netHost, Number(netPort) || 9100), 'WiFi/LAN printer connected')}
            >
              Connect
            </Button>
            <p className="mt-2 text-xs text-slate-500">
              The printer must be on the same WiFi/router as this device. Port is almost always 9100.
            </p>
          </div>
        )}

        {!support.usb && !support.bluetooth && !support.network && (
          <p className="mt-4 text-sm text-red-600">
            This browser can't talk to printers. Open the site in Chrome (Android / Windows) or Edge, or use the AuraOS Android app for WiFi/LAN printers.
          </p>
        )}

        {granted.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-semibold text-slate-700 mb-2">Available printers ({granted.length})</p>
            {granted.map((d, i) => (
              <div key={`${d.vendorId}-${d.productId}-${i}`} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 mb-2">
                <div>
                  <p className="text-sm font-medium text-slate-800">{d.productName || 'USB device'}</p>
                  <p className="text-xs text-slate-500">{d.manufacturerName ? `${d.manufacturerName} · ` : ''}USB {d.vendorId.toString(16)}:{d.productId.toString(16)}</p>
                </div>
                <Button size="sm" isLoading={busy} onClick={() => run(() => connectGrantedUsb(d), 'USB printer connected')}>
                  Connect
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card padding="md">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Print options (this device)</h2>
        <Choice label="Paper size" value={prefs.paperInches} onChange={(v) => update({ paperInches: v })}
          options={[{ label: '2 inch', value: 2 }, { label: '3 inch', value: 3 }]} />
        <Choice label="Auto cutter" value={prefs.autoCutter} onChange={(v) => update({ autoCutter: v })}
          options={[{ label: 'Yes', value: true }, { label: 'No', value: false }]} />
        <Choice label="Print UPI QR on bill" value={prefs.printUpiQr} onChange={(v) => update({ printUpiQr: v })}
          options={[{ label: 'Yes', value: true }, { label: 'No', value: false }]} />
      </Card>

      <Card padding="md">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">How to connect</h2>
        <ol className="list-decimal pl-5 text-sm text-slate-600 space-y-1">
          <li>Switch the printer on and plug it into this device with a USB cable (Android needs a USB-OTG adapter).</li>
          <li>Tap <b>Discover (USB)</b> and choose your printer.</li>
          <li>Tap <b>Allow</b> on the permission popup.</li>
          <li>Tap <b>Test print</b>. If the number line prints fully, you're done.</li>
          <li>On Windows, if you see "Access denied", the printer driver is blocking the browser: use the normal Print button (print dialog) instead, or ask me for the Zadig/WinUSB steps.</li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          Printing works from the device the printer is plugged into. Use Chrome (or Edge on Windows).
        </p>
      </Card>
    </div>
  )
}
