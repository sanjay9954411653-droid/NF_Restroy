/**
 * CancelItemsSheet — pick how many portions of each item to cancel on an open order.
 * Used from the table / pick-up drawer. The server removes the portions from the bill
 * (partial cancels keep the rest on the line) and recalculates the order total; if every
 * item ends up cancelled the order itself is cancelled.
 */
import { useState } from 'react'
import toast from 'react-hot-toast'
import { XMarkIcon, MinusIcon, PlusIcon } from '@heroicons/react/24/outline'
import api, { getErrorMessage } from '../api'
import { formatCurrency } from '../lib/utils'
import { formatWeight } from '../lib/weight'
import type { OrderItem } from '../types/order'

interface Props {
  orderId: string
  orderNumber: string
  title?: string // e.g. "Table T4"
  items: OrderItem[] // only the items still on the bill (not already cancelled)
  onClose: () => void
  onDone: () => void // called after something was cancelled
}

const CancelItemsSheet: React.FC<Props> = ({ orderId, orderNumber, title, items, onClose, onDone }) => {
  const [qty, setQty] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)

  const lines = items.filter((i) => i.id)
  const picked = lines.filter((i) => (qty[i.id as string] || 0) > 0)
  const pickedCount = picked.reduce((n, i) => n + (qty[i.id as string] || 0), 0)
  const refund = picked.reduce((s, i) => s + (qty[i.id as string] || 0) * Number(i.unit_price || 0), 0)

  const change = (id: string, delta: number, max: number) =>
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(max, (q[id] || 0) + delta)) }))

  const confirm = async () => {
    if (picked.length === 0) return
    const wholeOrder = picked.every((i) => qty[i.id as string] === i.quantity) && picked.length === lines.length
    if (wholeOrder && !window.confirm('This cancels every item, so the whole order will be cancelled. Continue?')) return

    setSaving(true)
    let done = 0
    for (const it of picked) {
      const n = qty[it.id as string]
      try {
        // Whole line -> plain cancel; part of a line -> cancel just those portions
        await api.patch(
          `/orders/${orderId}/items/${it.id}`,
          n === it.quantity ? { status: 'CANCELLED' } : { status: 'CANCELLED', cancel_quantity: n },
        )
        done++
      } catch (err) {
        toast.error(`${it.menu_item_name || 'Item'}: ${getErrorMessage(err)}`)
      }
    }
    setSaving(false)
    if (done > 0) {
      toast.success(done === picked.length ? 'Cancelled ✓' : 'Some items were cancelled')
      onDone()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => !saving && onClose()} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-gray-900 text-lg">Cancel items</p>
            <p className="text-sm text-gray-500">{[title, orderNumber].filter(Boolean).join(' · ')}</p>
          </div>
          <button onClick={onClose} disabled={saving} className="p-2 rounded-full hover:bg-gray-100">
            <XMarkIcon className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <ul className="space-y-2">
          {lines.map((it) => {
            const id = it.id as string
            const sel = qty[id] || 0
            const served = !!(it as any).served_at
            return (
              <li
                key={id}
                className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${sel > 0 ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{it.menu_item_name || 'Item'}</p>
                  <p className="text-xs text-gray-500">
                    {it.weight_grams ? formatWeight(it.weight_grams) : `${it.quantity} ordered`}
                    {' · '}
                    {formatCurrency(Number(it.unit_price || 0) * it.quantity)}
                    {served ? ' · already served' : it.status === 'DONE' ? ' · ready' : ''}
                  </p>
                </div>
                {served ? (
                  <span className="text-xs text-gray-400 shrink-0">Can't cancel</span>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => change(id, -1, it.quantity)}
                      disabled={saving || sel === 0}
                      className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center disabled:opacity-30"
                    >
                      <MinusIcon className="w-4 h-4" />
                    </button>
                    <span className="w-6 text-center font-bold text-gray-900">{sel}</span>
                    <button
                      onClick={() => change(id, 1, it.quantity)}
                      disabled={saving || sel >= it.quantity}
                      className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center disabled:opacity-30"
                    >
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
          {saving
            ? 'Cancelling…'
            : pickedCount === 0
              ? 'Choose what to cancel'
              : `Cancel ${pickedCount} portion${pickedCount > 1 ? 's' : ''} (−${formatCurrency(refund)})`}
        </button>
        <p className="text-xs text-gray-400 text-center">The bill total updates automatically. Tell the kitchen if it was already sent.</p>
      </div>
    </div>
  )
}

export default CancelItemsSheet
