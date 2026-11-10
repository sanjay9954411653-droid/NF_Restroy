import { useState } from 'react'
import toast from 'react-hot-toast'
import { XMarkIcon, MinusIcon, PlusIcon } from '@heroicons/react/24/outline'
import { ordersApi } from '../api/endpoints'
import { orderItemsOf } from '../lib/orderRounds'
import { printCancellationSlip } from '../lib/kotPrinter'
import type { Order } from '../types'
import { formatWeight } from '../lib/weight'

interface Props {
  order: Order
  onClose: () => void
  onDone: () => void
}

/**
 * Bottom sheet: pick how many portions of each item to cancel. Items already served can't be cancelled.
 * If a cancelled portion had already gone to the kitchen, a "STOP MAKING THESE" slip prints on this
 * device's WiFi printer (when one is set up) so the cooks see it.
 */
const CancelItemsSheet: React.FC<Props> = ({ order, onClose, onDone }) => {
  const items = orderItemsOf(order).filter((i) => i.id)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const picked = items.filter((i) => (qty[i.id!] || 0) > 0)
  const pickedCount = picked.reduce((n, i) => n + (qty[i.id!] || 0), 0)

  const change = (id: string, delta: number, max: number) =>
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(max, (q[id] || 0) + delta)) }))

  const confirm = async () => {
    if (picked.length === 0) return
    setSaving(true)
    const slipLines: { name: string; quantity: number }[] = []
    let failed = 0
    for (const it of picked) {
      try {
        await ordersApi.cancelItem(order.id, it.id!, qty[it.id!])
        if (it.kot_printed_at) slipLines.push({ name: it.menu_item_name || 'Item', quantity: qty[it.id!] })
      } catch (err: any) {
        failed++
        toast.error(err?.response?.data?.error?.message || `Could not cancel ${it.menu_item_name || 'item'}`)
      }
    }
    if (slipLines.length > 0) {
      const printed = await printCancellationSlip({
        orderNumber: order.order_number,
        table: order.table?.table_number,
        lines: slipLines,
      })
      if (!printed) toast('Tell the kitchen — these were already sent to them', { icon: '📣', duration: 7000 })
    }
    if (failed < picked.length) toast.success('Cancelled ✓')
    setSaving(false)
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/50" onClick={() => !saving && onClose()} />
      <div className="relative w-full bg-white rounded-t-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-gray-900 text-lg">Cancel items</p>
            <p className="text-sm text-gray-500">
              {order.order_number}{order.table?.table_number ? ` · Table ${order.table.table_number}` : ''}
            </p>
          </div>
          <button onClick={onClose} disabled={saving} className="p-2 rounded-full hover:bg-gray-100">
            <XMarkIcon className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <ul className="space-y-2">
          {items.map((it) => {
            const served = !!it.served_at
            const sel = qty[it.id!] || 0
            return (
              <li key={it.id} className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${sel > 0 ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{it.menu_item_name || 'Item'}</p>
                  <p className="text-xs text-gray-500">
                    {it.weight_grams ? formatWeight(it.weight_grams) : `${it.quantity} ordered`}{served ? ' · already served' : it.status === 'DONE' ? ' · ready' : ''}
                  </p>
                </div>
                {served ? (
                  <span className="text-xs text-gray-400 shrink-0">Can't cancel</span>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => change(it.id!, -1, it.quantity)} disabled={saving || sel === 0}
                      className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center disabled:opacity-30">
                      <MinusIcon className="w-4 h-4" />
                    </button>
                    <span className="w-6 text-center font-bold text-gray-900">{sel}</span>
                    <button onClick={() => change(it.id!, 1, it.quantity)} disabled={saving || sel >= it.quantity}
                      className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center disabled:opacity-30">
                      <PlusIcon className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <button
          onClick={confirm}
          disabled={saving || pickedCount === 0}
          className="w-full py-3 rounded-xl bg-red-600 text-white font-semibold text-base disabled:opacity-40"
        >
          {saving ? 'Cancelling…' : pickedCount === 0 ? 'Choose what to cancel' : `Cancel ${pickedCount} portion${pickedCount > 1 ? 's' : ''}`}
        </button>
        <p className="text-xs text-gray-400 text-center">The bill total updates automatically.</p>
      </div>
    </div>
  )
}

export default CancelItemsSheet
