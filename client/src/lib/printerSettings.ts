/**
 * Printer preferences, saved on THIS device (localStorage): paper size,
 * auto-cutter, and whether the UPI QR and the logo are printed on the bill.
 */
export interface PrinterPrefs {
  paperInches: 2 | 3
  autoCutter: boolean
  printUpiQr: boolean
  printLogo: boolean
}

const KEY = 'printer_prefs'
const DEFAULTS: PrinterPrefs = { paperInches: 3, autoCutter: true, printUpiQr: true, printLogo: true }

export function getPrinterPrefs(): PrinterPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw)
    return {
      paperInches: p.paperInches === 2 ? 2 : 3,
      autoCutter: p.autoCutter !== false,
      printUpiQr: p.printUpiQr !== false,
      printLogo: p.printLogo !== false,
    }
  } catch {
    return DEFAULTS
  }
}

export function savePrinterPrefs(p: PrinterPrefs): void {
  localStorage.setItem(KEY, JSON.stringify(p))
}

/** Characters per line: 2 inch (58mm) = 32, 3 inch (80mm) = 42. */
export const paperCols = (p: PrinterPrefs): number => (p.paperInches === 2 ? 32 : 42)
