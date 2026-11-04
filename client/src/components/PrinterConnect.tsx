/**
 * Small "connect your receipt printer" control for the bill screens.
 *
 * Once a USB (OTG) or Bluetooth printer is connected, "Print Bill" prints straight
 * to it instead of opening the phone's print dialog (which only offers "Save as PDF").
 * The browser remembers a USB printer, so after the first time this reconnects by itself.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { PrinterIcon } from '@heroicons/react/24/outline'
import {
  connectUSB,
  connectBluetooth,
  silentReconnectUSB,
  silentReconnectBluetooth,
  getConnectedPrinter,
  isPrinterSupported,
} from '../lib/thermalPrinter'
import type { PrinterKind } from '../lib/thermalPrinter'
import { getBillPaperWidth, setBillPaperWidth } from '../lib/billPrint'
import type { PaperWidth } from '../lib/billPrint'

const PrinterConnect: React.FC = () => {
  const [printer, setPrinter] = useState<PrinterKind | null>(getConnectedPrinter())
  const [busy, setBusy] = useState(false)
  const [paper, setPaper] = useState<PaperWidth>(getBillPaperWidth())
  const support = isPrinterSupported()

  useEffect(() => {
    if (printer) return
    ;(async () => {
      if (await silentReconnectUSB()) setPrinter('usb')
      else if (await silentReconnectBluetooth()) setPrinter('bluetooth')
    })()
  }, [printer])

  const connect = async (kind: PrinterKind) => {
    setBusy(true)
    try {
      if (kind === 'usb') await connectUSB()
      else await connectBluetooth()
      setPrinter(kind)
      toast.success(`${kind === 'usb' ? 'USB' : 'Bluetooth'} printer connected`)
    } catch (err: any) {
      // Closing the picker without choosing a device is not an error
      if (err?.name !== 'NotFoundError') toast.error(err?.message || 'Could not connect to the printer')
    } finally {
      setBusy(false)
    }
  }

  const changePaper = (w: PaperWidth) => {
    setPaper(w)
    setBillPaperWidth(w)
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
        <span className="font-medium text-emerald-700">
          {printer === 'usb' ? 'USB' : 'Bluetooth'} printer connected
        </span>
      ) : (
        <>
          <span className="text-gray-500">No printer connected:</span>
          {support.usb && (
            <button
              type="button"
              disabled={busy}
              onClick={() => connect('usb')}
              className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-medium disabled:opacity-50"
            >
              Connect USB
            </button>
          )}
          {support.bluetooth && (
            <button
              type="button"
              disabled={busy}
              onClick={() => connect('bluetooth')}
              className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-medium disabled:opacity-50"
            >
              Bluetooth
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
