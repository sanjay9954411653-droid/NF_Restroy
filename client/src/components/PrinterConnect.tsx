/**
 * Compact receipt-printer status for the bill screens.
 *
 * You normally do nothing here: the first "Print Bill" asks you to pick the printer once,
 * and after that it reconnects by itself. This row just shows the status, lets you print a
 * test slip, and choose the paper size.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { PrinterIcon } from '@heroicons/react/24/outline'
import {
  ensurePrinter,
  getConnectedPrinter,
  isPrinterSupported,
  connectBluetooth,
  printTest,
  getPrintMode,
  setPrintMode,
} from '../lib/thermalPrinter'
import type { PrinterKind } from '../lib/thermalPrinter'
import { getBillPaperWidth, setBillPaperWidth } from '../lib/billPrint'
import type { PaperWidth } from '../lib/billPrint'

const PrinterConnect: React.FC = () => {
  const [printer, setPrinter] = useState<PrinterKind | null>(getConnectedPrinter())
  const [busy, setBusy] = useState(false)
  const [paper, setPaper] = useState<PaperWidth>(getBillPaperWidth())
  const support = isPrinterSupported()
  const [mode, setMode] = useState(getPrintMode())

  useEffect(() => {
    const sync = () => setMode(getPrintMode())
    window.addEventListener('print-mode-changed', sync)
    return () => window.removeEventListener('print-mode-changed', sync)
  }, [])

  // Pick up a remembered printer without asking anything
  useEffect(() => {
    if (printer) return
    ensurePrinter(false).then((ok) => { if (ok) setPrinter(getConnectedPrinter()) }).catch(() => {})
  }, [printer])

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true)
    try {
      await fn()
      setPrinter(getConnectedPrinter())
      if (done) toast.success(done)
    } catch (err: any) {
      if (err?.name !== 'NotFoundError') toast.error(err?.message || 'Printer problem')
    } finally {
      setBusy(false)
    }
  }

  const changePaper = (w: PaperWidth) => {
    setPaper(w)
    setBillPaperWidth(w)
  }

  if (mode === 'system') {
    return (
      <div className="text-xs text-gray-500 space-y-1">
        <p>
          <span className="font-medium text-emerald-700">Using the Windows printer.</span>{' '}
          For one-click printing, make it the default printer and open Chrome with{' '}
          <code className="bg-gray-100 px-1 rounded">--kiosk-printing</code>.
        </p>
        <div className="flex items-center gap-2">
          <span>Paper</span>
          {([58, 80] as PaperWidth[]).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => changePaper(w)}
              className={`px-2 py-1 rounded-lg font-medium ${paper === w ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              {w}mm
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setPrintMode('direct'); setMode('direct') }}
            className="ml-auto underline text-gray-400"
          >
            Try direct USB
          </button>
        </div>
      </div>
    )
  }

  if (!support.usb && !support.bluetooth) {
    return (
      <p className="text-xs text-gray-400">
        Direct printing needs Chrome. In this browser, Print Bill opens the print dialog.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <PrinterIcon className="w-4 h-4 text-gray-400 shrink-0" />
      {printer ? (
        <>
          <span className="font-medium text-emerald-700">Printer ready</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => printTest(paper === 80 ? 42 : 32))}
            className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-medium disabled:opacity-50"
          >
            Test print
          </button>
        </>
      ) : (
        <>
          <span className="text-gray-500">Tap Print Bill to connect your printer</span>
          {support.bluetooth && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(connectBluetooth, 'Bluetooth printer connected')}
              className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-medium disabled:opacity-50"
            >
              Use Bluetooth
            </button>
          )}
        </>
      )}
      <span className="ml-auto flex items-center gap-1 text-gray-500">
        Paper
        {([58, 80] as PaperWidth[]).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => changePaper(w)}
            className={`px-2 py-1 rounded-lg font-medium ${
              paper === w ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {w}mm
          </button>
        ))}
      </span>
    </div>
  )
}

export default PrinterConnect
