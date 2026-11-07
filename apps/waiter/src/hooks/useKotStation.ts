import { useEffect } from 'react'
import { getKotPrefs, isPrinterConfigured, isWifiPrintingAvailable, sweepPendingKots } from '../lib/kotPrinter'

/**
 * "Kitchen printer station": while enabled on this device, print every new order's KOT.
 * Triggered by live order events (see useTableRequestsStore), a 15 s safety sweep, and whenever the app
 * comes back to the front. Also asks Android to keep the screen on, since a sleeping phone can't print.
 */
export function useKotStation(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let wakeLock: any = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const run = () => {
      const p = getKotPrefs()
      if (stopped || !p.station || !isWifiPrintingAvailable() || !isPrinterConfigured(p)) return
      sweepPendingKots().catch(() => {})
    }
    // Several events can arrive together (order + items); wait a moment so they become one sweep.
    const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(run, 600) }

    const keepAwake = async () => {
      try {
        if (!getKotPrefs().station || document.visibilityState !== 'visible') return
        wakeLock = await (navigator as any).wakeLock?.request('screen')
      } catch { /* not supported or denied: the screen may sleep */ }
    }

    run()
    keepAwake()
    const interval = setInterval(run, 15_000)
    const onVisible = () => { if (document.visibilityState === 'visible') { run(); keepAwake() } }
    window.addEventListener('kot-orders-changed', soon)
    window.addEventListener('kot-prefs-changed', soon)
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      stopped = true
      clearInterval(interval)
      if (timer) clearTimeout(timer)
      window.removeEventListener('kot-orders-changed', soon)
      window.removeEventListener('kot-prefs-changed', soon)
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', onVisible)
      wakeLock?.release?.().catch?.(() => {})
    }
  }, [enabled])
}
