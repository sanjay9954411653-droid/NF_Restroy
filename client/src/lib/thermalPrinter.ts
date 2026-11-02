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
import { formatWeight } from './weight'

// ── ESC/POS byte building ────────────────────────────────────────────────────
const ESC = 0x1b
const GS = 0x1d

function bytes(...parts: Array<number | string | number[]>): number[] {
  const out: number[] = []
  for (const p of parts) {
    if (typeof p === 'number') out.push(p)
    else if (typeof p === 'string') for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i) & 0xff)
    else out.push(...p)
  }
  return out
}

// Printers print plain ASCII reliably; ₹ and other symbols often don't render.
function ascii(s: string | undefined | null): string {
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
  const W = 42
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

  const tableLabel = order.table?.table_number ? `TABLE ${order.table.table_number}` : ascii(order.order_type || '')
  out.push(...center(`${tableLabel}  ·  ${ascii(order.order_source || '')}`))
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
  out.push(...bytes('\n\n\n'))
  out.push(...bytes(GS, 0x56, 1)) // partial cut
  return new Uint8Array(out)
}

// ── Connection state (kept in memory for this tab) ──────────────────────────
export type PrinterKind = 'usb' | 'bluetooth'
type PrinterHandle =
  | { kind: 'usb'; device: USBDevice; endpointOut: number }
  | { kind: 'bluetooth'; char: BluetoothRemoteGATTCharacteristic; device: BluetoothDevice }

let active: PrinterHandle | null = null
const USB_KEY = 'kitchen_printer_usb' // { vendorId, productId }

export function isPrinterSupported(): { usb: boolean; bluetooth: boolean } {
  return { usb: !!navigator.usb, bluetooth: !!navigator.bluetooth }
}

export function getConnectedPrinter(): PrinterKind | null {
  return active?.kind ?? null
}

// ── USB ───────────────────────────────────────────────────────────────────
async function openUsbDevice(device: USBDevice): Promise<PrinterHandle> {
  if (!device.opened) await device.open()
  if (!device.configuration) await device.selectConfiguration(1)
  const iface = device.configuration!.interfaces[0]
  await device.claimInterface(iface.interfaceNumber)
  const outEp = iface.alternate.endpoints.find((e) => e.direction === 'out')
  if (!outEp) throw new Error('This USB device has no output endpoint — is it a printer?')
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
  active = null
}

/** Sends raw ESC/POS bytes to whichever printer is currently connected. */
export async function printRaw(data: Uint8Array): Promise<void> {
  if (!active) throw new Error('No printer connected')
  if (active.kind === 'usb') {
    // USB printers generally want the ticket in one write; large tickets are chunked.
    const CHUNK = 4096
    for (let i = 0; i < data.length; i += CHUNK) {
      await active.device.transferOut(active.endpointOut, data.slice(i, i + CHUNK))
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
  await printRaw(buildKOTBytes(order, items, restaurantName, round))
}
