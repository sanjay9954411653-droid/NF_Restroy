/**
 * Direct printing to an 80mm/58mm ESC/POS thermal kitchen printer, over USB
 * or Bluetooth — no print dialog, no browser popup, no person needed at the
 * screen. This is what makes automatic KOT printing possible.
 *
 * Coverage, honestly:
 *  - USB:       works well. Any Chrome-based browser, including Chrome on
 *               Android with a USB-OTG cable. The printer must support raw
 *               ESC/POS over USB (nearly all thermal receipt/kitchen
 *               printers do — the same standard used by most POS software).
 *  - Bluetooth: only works with newer "Bluetooth Low Energy" (BLE) printers.
 *               Most budget thermal printers instead use classic Bluetooth
 *               (SPP), which no browser can talk to — Web Bluetooth simply
 *               doesn't expose it. If your printer is Bluetooth and this
 *               doesn't connect, that is very likely why; USB is the safe
 *               fallback for that printer.
 *
 * The browser remembers a granted USB device across reloads (navigator.usb.
 * getDevices()), so the kitchen tablet can silently reconnect on its own
 * after the page is refreshed or the tablet restarts. Bluetooth's equivalent
 * (navigator.bluetooth.getDevices()) is newer and not supported everywhere,
 * so a Bluetooth printer may need "Connect Printer" tapped again after a
 * browser restart — the on-screen banner makes that obvious.
 */

import type { Order, OrderItem } from '../types/order'
import toast from 'react-hot-toast'
import { formatWeight } from './weight'
import { getPrinterPrefs, paperCols } from './printerSettings'
import api from '../api'

// ── ESC/POS byte building ────────────────────────────────────────────────────
const ESC = 0x1b
const GS = 0x1d

export function bytes(...parts: Array<number | string | number[]>): number[] {
  const out: number[] = []
  for (const p of parts) {
    if (typeof p === 'number') out.push(p)
    else if (typeof p === 'string') for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i) & 0xff)
    else out.push(...p)
  }
  return out
}

// Printers print plain ASCII reliably; ₹ and other symbols often don't render.
export function ascii(s: string | undefined | null): string {
  return (s || '').replace(/₹/g, 'Rs.').replace(/[^\x20-\x7e\n]/g, '')
}

function line(width: number, ch = '-'): string {
  return ch.repeat(width) + '\n'
}

export interface KOTOrder {
  order_number: string
  table?: { table_number?: string | number } | null
  order_type?: string
  order_source?: string
  special_instructions?: string | null
  created_at?: string
}

/** Builds the raw bytes for one Kitchen Order Ticket. 42 chars fits an 80mm printer. */
export function buildKOTBytes(order: KOTOrder | Order, items: OrderItem[], restaurantName = 'Kitchen', round?: number): Uint8Array {
  const prefs = getPrinterPrefs()
  const W = paperCols(prefs)
  const center = (s: string) => bytes(ESC, 0x61, 1, s + '\n')
  const left = (s: string) => bytes(ESC, 0x61, 0, s + '\n')
  const bold = (on: boolean) => bytes(ESC, 0x45, on ? 1 : 0)
  const big = (on: boolean) => bytes(GS, 0x21, on ? 0x11 : 0x00) // double width + height

  let out: number[] = []
  out.push(...bytes(ESC, 0x40)) // reset
  out.push(...center(ascii(restaurantName).toUpperCase()))
  out.push(...center('KITCHEN ORDER TICKET'))
  out.push(...left(line(W)))

  out.push(...bold(true), ...big(true))
  out.push(...center(ascii(order.order_number)))
  out.push(...big(false), ...bold(false))

  const tableLabel = order.table?.table_number ? `TABLE ${order.table.table_number}` : ascii(order.order_type === 'PARCEL' ? 'PICK-UP' : (order.order_type || ''))
  out.push(...center(`${tableLabel}  -  ${ascii(order.order_source || '')}`))
  if (order.created_at) out.push(...center(new Date(order.created_at).toLocaleString('en-IN')))
  if (round && round > 1) {
    out.push(...bold(true), ...big(true))
    out.push(...center(`ROUND ${round}`))
    out.push(...big(false), ...bold(false))
    out.push(...center('ADD-ON ITEMS ONLY'))
  }
  out.push(...left(line(W)))

  for (const item of items) {
    out.push(...bold(true))
    out.push(...left(`${item.weight_grams ? formatWeight(item.weight_grams) : `${item.quantity}x`}  ${ascii(item.menu_item_name || item.menu_item_id)}`))
    out.push(...bold(false))
    const mods = (item as any).modifiers as Array<{ modifier_option_name: string }> | undefined
    if (mods?.length) out.push(...left(`    ${ascii(mods.map((m) => m.modifier_option_name).join(', '))}`))
    if (item.special_instructions) out.push(...left(`    * ${ascii(item.special_instructions)}`))
  }

  if (order.special_instructions) {
    out.push(...left(line(W)))
    out.push(...bold(true), ...left('NOTE:'), ...bold(false))
    out.push(...left(ascii(order.special_instructions)))
  }

  out.push(...left(line(W)))
  out.push(...center(new Date().toLocaleTimeString('en-IN')))
  out.push(...bytes(prefs.autoCutter ? '\n\n\n' : '\n\n\n\n\n'))
  if (prefs.autoCutter) out.push(...bytes(GS, 0x56, 1)) // partial cut
  return new Uint8Array(out)
}

// ── Connection state (kept in memory for this tab) ──────────────────────────
export type PrinterKind = 'usb' | 'bluetooth' | 'network' | 'bridge'
type PrinterHandle =
  | { kind: 'usb'; device: USBDevice; endpointOut: number }
  | { kind: 'network'; host: string; port: number }
  | { kind: 'bridge' }
  | { kind: 'bluetooth'; char: BluetoothRemoteGATTCharacteristic; device: BluetoothDevice }

let active: PrinterHandle | null = null
const USB_KEY = 'kitchen_printer_usb' // { vendorId, productId }

export function isPrinterSupported(): { usb: boolean; bluetooth: boolean; network: boolean } {
  return { usb: !!navigator.usb, bluetooth: !!navigator.bluetooth, network: !!getTcpPlugin() }
}

// ── WiFi / LAN (Ethernet) printers — Android app only ───────────────────────
// A browser cannot open a raw TCP connection, so this works only inside the
// AuraOS Android app (Capacitor), which ships a native "TcpPrinter" plugin
// that sends the ESC/POS bytes to <printer IP>:9100.
interface TcpPrinterPlugin {
  check(opts: { host: string; port: number; timeoutMs?: number }): Promise<void>
  print(opts: { host: string; port: number; data: string; timeoutMs?: number }): Promise<void>
}
function getTcpPlugin(): TcpPrinterPlugin | null {
  const cap = typeof window !== 'undefined' ? (window as any).Capacitor : null
  if (!cap?.isNativePlatform?.() || !cap.isPluginAvailable?.('TcpPrinter') || !cap.nativePromise) return null
  // Call the native plugin through Capacitor's injected bridge (works even when the app loads a remote URL).
  return {
    check: (opts) => cap.nativePromise('TcpPrinter', 'check', opts),
    print: (opts) => cap.nativePromise('TcpPrinter', 'print', opts),
  }
}

// ── Print bridge (a PC at the restaurant prints for us) ─────────────────────
// With this on, anything printed from THIS device (receipts, manual KOT reprints) is queued on the
// server and the restaurant's bridge program prints it. Works in any browser, no USB/Bluetooth needed.
const BRIDGE_KEY = 'print_via_bridge'

export function isUsingBridge(): boolean {
  try { return localStorage.getItem(BRIDGE_KEY) === '1' } catch { return false }
}

export function setUseBridge(on: boolean): void {
  try {
    if (on) localStorage.setItem(BRIDGE_KEY, '1')
    else localStorage.removeItem(BRIDGE_KEY)
  } catch { /* storage blocked */ }
  if (on) active = { kind: 'bridge' }
  else if (active?.kind === 'bridge') active = null
  reconnectTried = null
  window.dispatchEvent(new Event('print-mode-changed'))
}

const NET_KEY = 'kitchen_printer_network' // { host, port }

export function getSavedNetworkPrinter(): { host: string; port: number } | null {
  try {
    const raw = localStorage.getItem(NET_KEY)
    if (!raw) return null
    const { host, port } = JSON.parse(raw)
    return host ? { host: String(host), port: Number(port) || 9100 } : null
  } catch {
    return null
  }
}

function toBase64(data: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Connect to a WiFi/LAN printer by IP (default port 9100) and remember it on this device. */
export async function connectNetwork(host: string, port = 9100): Promise<void> {
  const tcp = getTcpPlugin()
  if (!tcp) throw new Error('WiFi/LAN printing works only in the AuraOS Android app.')
  host = host.trim()
  if (!/^[a-zA-Z0-9.\-]+$/.test(host)) throw new Error('Enter a valid printer IP, like 192.168.1.50')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a valid port (usually 9100)')
  await tcp.check({ host, port, timeoutMs: 4000 }).catch(() => {
    throw new Error(`Can't reach ${host}:${port}. Check the printer is on, on the same WiFi, and the IP is right.`)
  })
  active = { kind: 'network', host, port }
  localStorage.setItem(NET_KEY, JSON.stringify({ host, port }))
}

/** Network printers have no pairing, so "reconnect" just reuses the saved IP (checked lazily when printing). */
export async function silentReconnectNetwork(): Promise<boolean> {
  const saved = getSavedNetworkPrinter()
  if (!saved || !getTcpPlugin()) return false
  active = { kind: 'network', host: saved.host, port: saved.port }
  return true
}

export function forgetNetworkPrinter(): void {
  try { localStorage.removeItem(NET_KEY) } catch { /* ignore */ }
  if (active?.kind === 'network') active = null
}

export function getConnectedPrinter(): PrinterKind | null {
  return active?.kind ?? null
}

// ── USB ───────────────────────────────────────────────────────────────────
async function openUsbDevice(device: USBDevice): Promise<PrinterHandle> {
  if (!device.opened) await device.open()
  if (!device.configuration) await device.selectConfiguration(1)
  // Use the printer-class (7) interface if there is one, else the first with an OUT endpoint.
  const withOut = device.configuration!.interfaces.filter((i) => i.alternate.endpoints.some((e) => e.direction === 'out'))
  const iface = withOut.find((i) => i.alternate.interfaceClass === 7) || withOut[0]
  if (!iface) throw new Error('This USB device has no output endpoint — is it a printer?')
  await device.claimInterface(iface.interfaceNumber)
  const outEp = iface.alternate.endpoints.find((e) => e.direction === 'out')!
  return { kind: 'usb', device, endpointOut: outEp.endpointNumber }
}

/** Shows the browser's USB device picker (must be called from a click handler). */
export async function connectUSB(): Promise<void> {
  if (!navigator.usb) throw new Error('This browser does not support USB printing. Use Chrome.')
  const device = await navigator.usb.requestDevice({ filters: [] })
  active = await openUsbDevice(device)
  localStorage.setItem(USB_KEY, JSON.stringify({ vendorId: device.vendorId, productId: device.productId }))
}

/** Tries to silently reconnect to a previously-granted USB printer. No prompt shown. */
export async function silentReconnectUSB(): Promise<boolean> {
  if (!navigator.usb) return false
  const saved = localStorage.getItem(USB_KEY)
  if (!saved) return false
  try {
    const { vendorId, productId } = JSON.parse(saved)
    const devices = await navigator.usb.getDevices()
    const device = devices.find((d) => d.vendorId === vendorId && d.productId === productId)
    if (!device) return false
    active = await openUsbDevice(device)
    return true
  } catch {
    return false
  }
}

// ── Bluetooth (BLE printers only — see file header) ─────────────────────────
// Service/characteristic UUID used by many common BLE thermal printers.
// Some brands use a different UUID; if connecting fails, the printer is most
// likely classic Bluetooth (SPP), which the browser cannot reach at all.
const BLE_PRINTER_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb'
const BLE_PRINTER_WRITE_CHAR = '00002af1-0000-1000-8000-00805f9b34fb'

async function openBluetoothDevice(device: BluetoothDevice): Promise<PrinterHandle> {
  const server = await device.gatt!.connect()
  const service = await server.getPrimaryService(BLE_PRINTER_SERVICE)
  const char = await service.getCharacteristic(BLE_PRINTER_WRITE_CHAR)
  return { kind: 'bluetooth', char, device }
}

/** Shows the browser's Bluetooth device picker (must be called from a click handler). */
export async function connectBluetooth(): Promise<void> {
  if (!navigator.bluetooth) throw new Error('This browser does not support Bluetooth printing. Use Chrome.')
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [BLE_PRINTER_SERVICE],
  })
  active = await openBluetoothDevice(device)
}

/** Tries to silently reconnect to a previously-granted BLE printer, if the browser supports it. */
export async function silentReconnectBluetooth(): Promise<boolean> {
  if (!navigator.bluetooth?.getDevices) return false
  try {
    const devices = await navigator.bluetooth.getDevices()
    for (const device of devices) {
      if (!device.gatt) continue
      try {
        active = await openBluetoothDevice(device)
        return true
      } catch {
        continue
      }
    }
    return false
  } catch {
    return false
  }
}

export function disconnectPrinter(): void {
  if (active?.kind === 'bridge') setUseBridge(false)
  if (active?.kind === 'network') forgetNetworkPrinter()
  active = null
}

/** Sends raw ESC/POS bytes to whichever printer is currently connected. */
export async function printRaw(data: Uint8Array, target: 'KOT' | 'BILL' = 'BILL'): Promise<void> {
  if (!active) throw new Error('No printer connected')
  if (active.kind === 'bridge') {
    try {
      await api.post('/print-bridge/jobs/raw', { target, data_base64: toBase64(data) })
    } catch (err: any) {
      throw new Error(err?.response?.data?.error?.message || 'Could not send the print job to the restaurant printer')
    }
    return
  }
  if (active.kind === 'network') {
    const tcp = getTcpPlugin()
    if (!tcp) throw new Error('WiFi/LAN printing works only in the AuraOS Android app.')
    try {
      await tcp.print({ host: active.host, port: active.port, data: toBase64(data), timeoutMs: 6000 })
    } catch (err: any) {
      // Keep the saved IP but drop the live handle so the next print retries cleanly
      active = null
      reconnectTried = null
      throw new Error(`Printer ${getSavedNetworkPrinter()?.host ?? ''} not reachable. Is it on and on the same WiFi?`)
    }
    return
  }
  if (active.kind === 'usb') {
    // USB printers generally want the ticket in one write; large tickets are chunked.
    const CHUNK = 4096
    try {
      for (let i = 0; i < data.length; i += CHUNK) {
        await active.device.transferOut(active.endpointOut, data.slice(i, i + CHUNK))
      }
    } catch (err) {
      // Unplugged or taken over by another program: forget it so the next print reconnects (or falls back) cleanly
      active = null
      reconnectTried = null
      throw err
    }
  } else {
    const CHUNK = 180 // typical BLE write size limit
    for (let i = 0; i < data.length; i += CHUNK) {
      const chunk = data.slice(i, i + CHUNK)
      if (active.char.writeValueWithoutResponse) await active.char.writeValueWithoutResponse(chunk)
      else await active.char.writeValue(chunk)
    }
  }
}

/** Convenience: build and print a KOT in one call. */
export async function printKOTRaw(order: KOTOrder | Order, items: OrderItem[], restaurantName?: string, round?: number): Promise<void> {
  await printRaw(buildKOTBytes(order, items, restaurantName, round), 'KOT')
}


// ── Settings-page helpers ───────────────────────────────────────────────────
/** Name of the connected printer, for display. */
export function getConnectedPrinterName(): string | null {
  if (!active) return null
  if (active.kind === 'bridge') return 'Restaurant print bridge'
  if (active.kind === 'network') return `WiFi/LAN printer ${active.host}:${active.port}`
  return active.kind === 'usb' ? active.device.productName || 'USB printer' : active.device.name || 'Bluetooth printer'
}

/** USB devices this site was already given permission to use (the "Available Printers" list). */
export async function listGrantedUsb(): Promise<USBDevice[]> {
  if (!navigator.usb) return []
  try {
    return await navigator.usb.getDevices()
  } catch {
    return []
  }
}

/** Connect to one of the already-permitted USB devices (no picker shown). */
export async function connectGrantedUsb(device: USBDevice): Promise<void> {
  active = await openUsbDevice(device)
  localStorage.setItem(USB_KEY, JSON.stringify({ vendorId: device.vendorId, productId: device.productId }))
}

let reconnectTried: Promise<void> | null = null
/** Once per page load, quietly re-connect to the last printer so printing works after a refresh. */
export function ensurePrinterReconnected(): Promise<void> {
  if (active) return Promise.resolve()
  if (!reconnectTried) {
    reconnectTried = (async () => {
      if (isUsingBridge()) { active = { kind: 'bridge' }; return }
      if (await silentReconnectNetwork()) return
      if (await silentReconnectUSB()) return
      await silentReconnectBluetooth()
    })().then(() => {
      if (!active) reconnectTried = null // allow another try later (e.g. printer plugged in afterwards)
    })
  }
  return reconnectTried
}

export function buildTestBytes(cols?: number): Uint8Array {
  const prefs = getPrinterPrefs()
  const W = cols ?? paperCols(prefs)
  const out: number[] = []
  out.push(...bytes(ESC, 0x40))
  out.push(...bytes(ESC, 0x61, 1, 'PRINTER TEST\n'))
  out.push(...bytes(ESC, 0x61, 0, '-'.repeat(W) + '\n'))
  out.push(...bytes(`Paper: ${prefs.paperInches} inch (${W} chars)\n`))
  out.push(...bytes(`Auto cutter: ${prefs.autoCutter ? 'Yes' : 'No'}\n`))
  out.push(...bytes('1234567890'.repeat(5).slice(0, W) + '\n'))
  out.push(...bytes('If the number line above is fully\nvisible, the paper size is correct.\n'))
  out.push(...bytes('-'.repeat(W) + '\n'))
  out.push(...bytes(prefs.autoCutter ? '\n\n\n' : '\n\n\n\n\n'))
  if (prefs.autoCutter) out.push(...bytes(GS, 0x56, 1))
  return new Uint8Array(out)
}

export async function printTest(cols?: number): Promise<void> {
  await printRaw(buildTestBytes(cols))
}

// ── Print mode + "make sure a printer is ready" ─────────────────────────────
/**
 * direct: send the bill / KOT straight to the USB or Bluetooth thermal printer (no print dialog).
 * system: use the computer's own printer through the normal browser print. Set the thermal printer as the
 *         default printer and start Chrome with --kiosk-printing for one-click printing. Chosen automatically
 *         when the browser is not allowed to open the USB printer (typical on Windows when the printer's own
 *         driver is installed).
 */
export type PrintMode = 'direct' | 'system'
const MODE_KEY = 'print_mode'

export function getPrintMode(): PrintMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'system' ? 'system' : 'direct'
  } catch {
    return 'direct'
  }
}

export function setPrintMode(mode: PrintMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    /* storage blocked: the choice just lasts until reload */
  }
  window.dispatchEvent(new Event('print-mode-changed'))
}

/**
 * Make sure a printer is connected: reuse the live connection, then quietly reconnect the remembered one.
 * With prompt=true (call it straight from a button tap) it also opens the browser's printer picker the
 * first time. Resolves false when there is no direct printer; a picker closed without choosing throws a
 * NotFoundError.
 */
export async function ensurePrinter(prompt = false): Promise<boolean> {
  if (active) return true
  await ensurePrinterReconnected()
  if (active) return true
  if (!prompt) return false
  if (navigator.usb) await connectUSB()
  else if (navigator.bluetooth) await connectBluetooth()
  return !!active
}

/**
 * Get the printer ready for a print button. Call it straight from the tap: the first time the browser asks
 * which USB printer to use, and it remembers the answer. Never throws. Returns true when the job can go
 * directly to the printer; false means use the normal print dialog.
 */
export async function preparePrinter(): Promise<boolean> {
  if (getPrintMode() === 'system') return false
  try {
    return await ensurePrinter(true)
  } catch (err: any) {
    // NotFoundError: the picker was closed without choosing. Just use the print dialog this time.
    if (err?.name === 'SecurityError' || err?.name === 'NetworkError') {
      // The browser may not open this USB printer (on Windows its own driver usually owns it).
      // Stop trying direct USB and use the computer's printer; "Try direct USB" switches it back.
      console.warn('Direct USB printing is not available here, using the computer printer', err)
      setPrintMode('system')
      toast("The browser can't open this USB printer directly, so printing will use the computer's printer.", { duration: 7000 })
    } else if (err?.name !== 'NotFoundError') {
      console.warn('Could not connect the printer', err)
    }
    return false
  }
}

// Forget a USB printer the moment it is unplugged, and pick it up again when it is plugged back in,
// so Print never points at a dead connection.
if (typeof navigator !== 'undefined' && navigator.usb) {
  navigator.usb.addEventListener('disconnect', (e: Event) => {
    const gone = (e as unknown as { device?: USBDevice }).device
    if (active?.kind === 'usb' && (!gone || active.device === gone)) {
      active = null
      reconnectTried = null
    }
  })
  navigator.usb.addEventListener('connect', () => {
    reconnectTried = null
    ensurePrinterReconnected().catch(() => {})
  })
}
