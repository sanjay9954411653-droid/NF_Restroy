/**
 * KOT (kitchen ticket) printing from the Waiter app to a WiFi / LAN thermal printer.
 *
 * A web page cannot open a raw TCP connection, so this works inside the AuraOS Android app
 * (a thin Capacitor wrapper around this site that adds a native "TcpPrinter" plugin which sends
 * ESC/POS bytes to <printer IP>:9100). In a normal browser the settings card explains this.
 *
 * Two ways a ticket gets printed:
 *  1. "Auto-print my orders": when THIS waiter places an order or adds items, the ticket prints at once.
 *  2. "Kitchen printer station": this device prints EVERY new order (other waiters, QR/online orders once
 *     accepted) — so the restaurant needs no kitchen display. Keep the app open on that device.
 *
 * Nothing prints twice: before printing, the device asks the server to "claim" the order's unprinted
 * items (atomic). Items another device or the print bridge already took come back empty. If the printer
 * can't be reached the items are released so they can be printed again.
 */
import toast from 'react-hot-toast'
import { ordersApi, type KotTicketData } from '../api/endpoints'

// ── Settings (saved on this device) ─────────────────────────────────────────
export interface KotPrefs {
  host: string
  port: number
  paperInches: 2 | 3
  autoCutter: boolean
  autoPrintMine: boolean // print when I place an order / add items
  station: boolean       // print every new order from this device
}

const KEY = 'waiter_kot_prefs'
const DEFAULTS: KotPrefs = { host: '', port: 9100, paperInches: 3, autoCutter: true, autoPrintMine: true, station: false }

export function getKotPrefs(): KotPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      host: typeof p.host === 'string' ? p.host : '',
      port: Number(p.port) > 0 ? Number(p.port) : 9100,
      paperInches: p.paperInches === 2 ? 2 : 3,
      autoCutter: p.autoCutter !== false,
      autoPrintMine: p.autoPrintMine !== false,
      station: p.station === true,
    }
  } catch {
    return DEFAULTS
  }
}

export function saveKotPrefs(patch: Partial<KotPrefs>): KotPrefs {
  const next = { ...getKotPrefs(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage blocked */ }
  window.dispatchEvent(new Event('kot-prefs-changed'))
  return next
}

export const isPrinterConfigured = (p = getKotPrefs()) => !!p.host

// ── Native WiFi plugin (Android app only) ───────────────────────────────────
interface TcpPrinterPlugin {
  check(o: { host: string; port: number; timeoutMs?: number }): Promise<void>
  print(o: { host: string; port: number; data: string; timeoutMs?: number }): Promise<void>
}

function getTcpPlugin(): TcpPrinterPlugin | null {
  const cap = typeof window !== 'undefined' ? (window as any).Capacitor : null
  if (!cap?.isNativePlatform?.() || !cap.isPluginAvailable?.('TcpPrinter') || !cap.nativePromise) return null
  return {
    check: (o) => cap.nativePromise('TcpPrinter', 'check', o),
    print: (o) => cap.nativePromise('TcpPrinter', 'print', o),
  }
}

/** True inside the Android app, where WiFi printing is possible. */
export const isWifiPrintingAvailable = (): boolean => !!getTcpPlugin()

function toBase64(data: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function sendToPrinter(data: Uint8Array, prefs = getKotPrefs()): Promise<void> {
  const tcp = getTcpPlugin()
  if (!tcp) throw new Error('WiFi printing works only in the AuraOS Waiter Android app.')
  if (!prefs.host) throw new Error('Set the printer IP first (Profile → Kitchen printer).')
  try {
    await tcp.print({ host: prefs.host, port: prefs.port, data: toBase64(data), timeoutMs: 6000 })
  } catch {
    throw new Error(`Printer ${prefs.host} not reachable. Is it on, and on the same WiFi?`)
  }
}

/** Checks the printer answers on the network. Throws a readable error if not. */
export async function checkPrinter(host: string, port: number): Promise<void> {
  const tcp = getTcpPlugin()
  if (!tcp) throw new Error('WiFi printing works only in the AuraOS Waiter Android app.')
  host = host.trim()
  if (!/^[a-zA-Z0-9.\-]+$/.test(host)) throw new Error('Enter a valid printer IP, like 192.168.1.50')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a valid port (usually 9100)')
  await tcp.check({ host, port, timeoutMs: 4000 }).catch(() => {
    throw new Error(`Can't reach ${host}:${port}. Check the printer is on, on the same WiFi, and the IP is right.`)
  })
}

// ── ESC/POS ─────────────────────────────────────────────────────────────────
const ESC = 0x1b
const GS = 0x1d
const bytes = (...parts: Array<number | string>): number[] => {
  const out: number[] = []
  for (const p of parts) {
    if (typeof p === 'number') out.push(p)
    else for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i) & 0xff)
  }
  return out
}
// Thermal printers print plain ASCII reliably; ₹ and other symbols often don't render.
const ascii = (s?: string | null) => (s || '').replace(/₹/g, 'Rs.').replace(/[^\x20-\x7e\n]/g, '')
const cols = (p: KotPrefs) => (p.paperInches === 2 ? 32 : 42)

function formatWeight(grams?: number | null): string {
  const g = Number(grams) || 0
  if (g <= 0) return ''
  if (g < 1000) return `${g} g`
  const kg = g / 1000
  return `${Number.isInteger(kg) ? kg : parseFloat(kg.toFixed(3))} kg`
}

export function buildKotBytes(t: KotTicketData, round: KotTicketData['rounds'][number], prefs = getKotPrefs()): Uint8Array {
  const W = cols(prefs)
  const center = (s: string) => bytes(ESC, 0x61, 1, s + '\n')
  const left = (s: string) => bytes(ESC, 0x61, 0, s + '\n')
  const bold = (on: boolean) => bytes(ESC, 0x45, on ? 1 : 0)
  const big = (on: boolean) => bytes(GS, 0x21, on ? 0x11 : 0x00)
  const rule = '-'.repeat(W)

  const out: number[] = [...bytes(ESC, 0x40)]
  out.push(...center(ascii(t.restaurant_name).toUpperCase()), ...center('KITCHEN ORDER TICKET'), ...left(rule))
  out.push(...bold(true), ...big(true), ...center(ascii(t.order_number)), ...big(false), ...bold(false))

  const where = t.table_number
    ? `TABLE ${ascii(String(t.table_number))}${t.guest_label ? ` (${ascii(t.guest_label)})` : ''}`
    : ascii(t.order_type === 'PARCEL' ? 'PICK-UP' : t.order_type)
  out.push(...center(`${where}  -  ${ascii(t.order_source)}`))
  out.push(...center(new Date(t.created_at).toLocaleString('en-IN')))
  if (round.round > 1) {
    out.push(...bold(true), ...big(true), ...center(`ROUND ${round.round}`), ...big(false), ...bold(false))
    out.push(...center('ADD-ON ITEMS ONLY'))
  }
  out.push(...left(rule))

  for (const it of round.items) {
    out.push(...bold(true), ...left(`${it.weight_grams ? formatWeight(it.weight_grams) : `${it.quantity}x`}  ${ascii(it.name)}`), ...bold(false))
    if (it.modifiers?.length) out.push(...left(`    ${ascii(it.modifiers.join(', '))}`))
    if (it.special_instructions) out.push(...left(`    * ${ascii(it.special_instructions)}`))
  }
  if (t.special_instructions) {
    out.push(...left(rule), ...bold(true), ...left('NOTE:'), ...bold(false), ...left(ascii(t.special_instructions)))
  }
  out.push(...left(rule), ...center(new Date().toLocaleTimeString('en-IN')))
  out.push(...bytes(prefs.autoCutter ? '\n\n\n' : '\n\n\n\n\n'))
  if (prefs.autoCutter) out.push(...bytes(GS, 0x56, 1))
  return new Uint8Array(out)
}

export async function printTestSlip(): Promise<void> {
  const prefs = getKotPrefs()
  const W = cols(prefs)
  const out = [
    ...bytes(ESC, 0x40, ESC, 0x61, 1, 'PRINTER TEST\n', ESC, 0x61, 0, '-'.repeat(W) + '\n'),
    ...bytes(`Paper: ${prefs.paperInches} inch (${W} chars)\n`, `Auto cutter: ${prefs.autoCutter ? 'Yes' : 'No'}\n`),
    ...bytes('1234567890'.repeat(5).slice(0, W) + '\n', 'If the number line above is fully\nvisible, the paper size is correct.\n'),
    ...bytes('-'.repeat(W) + '\n', prefs.autoCutter ? '\n\n\n' : '\n\n\n\n\n'),
    ...(prefs.autoCutter ? bytes(GS, 0x56, 1) : []),
  ]
  await sendToPrinter(new Uint8Array(out), prefs)
}

// ── Claim + print ───────────────────────────────────────────────────────────
// One ticket at a time: two simultaneous connections to a small thermal printer can garble the paper.
let queue: Promise<unknown> = Promise.resolve()
const inFlight = new Set<string>()
let lastErrorToast = 0

function errorToast(msg: string) {
  if (Date.now() - lastErrorToast < 30_000) return // don't stack the same error every few seconds
  lastErrorToast = Date.now()
  toast.error(msg, { duration: 8000 })
}

async function claimAndPrint(orderId: string, attempt = 1): Promise<number> {
  const prefs = getKotPrefs()
  const res = await ordersApi.kotClaim(orderId)
  const kot = res.data.data.kot
  if (!kot) return 0 // already printed (by the bridge, the kitchen screen or another device) or nothing to print

  try {
    for (const round of kot.rounds) await sendToPrinter(buildKotBytes(kot, round, prefs), prefs)
    toast.success(`KOT printed — ${kot.order_number}`, { icon: '🖨️', duration: 2500 })
    return kot.rounds.length
  } catch (err: any) {
    // Not printed: give the items back so a retry (or the station sweep) can print them
    await ordersApi.kotRelease(orderId, kot.rounds.flatMap((r) => r.item_ids)).catch(() => {})
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 2500))
      return claimAndPrint(orderId, attempt + 1)
    }
    errorToast(`Couldn't print KOT ${kot.order_number}: ${err?.message || 'printer error'}`)
    return 0
  }
}

/** Print the KOT for any not-yet-printed items of this order. Safe to call any number of times. */
export function printKotForOrder(orderId: string): Promise<number> {
  if (inFlight.has(orderId)) return Promise.resolve(0)
  inFlight.add(orderId)
  const job = queue.then(() => claimAndPrint(orderId)).catch((err) => {
    console.warn('[kot] print failed', err)
    return 0
  }).finally(() => inFlight.delete(orderId))
  queue = job
  return job
}

/** Called right after THIS waiter places an order / adds items. */
export function autoPrintAfterOrder(orderId: string | undefined | null): void {
  const prefs = getKotPrefs()
  if (!orderId || !isWifiPrintingAvailable() || !isPrinterConfigured(prefs)) return
  if (prefs.autoPrintMine || prefs.station) void printKotForOrder(orderId)
}

/** Station mode: print everything the server says is still waiting for a KOT. */
export async function sweepPendingKots(): Promise<void> {
  const prefs = getKotPrefs()
  if (!prefs.station || !isWifiPrintingAvailable() || !isPrinterConfigured(prefs)) return
  const res = await ordersApi.kotPending()
  for (const id of res.data.data.order_ids) await printKotForOrder(id)
}
