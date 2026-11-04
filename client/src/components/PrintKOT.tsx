/**
 * PrintKOT — Kitchen Order Ticket
 *
 * Prints a ticket for the kitchen showing:
 *   - Order number (large, easy to read)
 *   - Table / order type
 *   - Each item with quantity and special instructions
 *   - Timestamp
 *
 * Sends KOTs directly to the connected ESC/POS thermal printer.
 *
 * Usage:
 *   <PrintKOT order={order} items={items} onClose={() => {}} />
 *
 * Or call printKOT(order, items) directly to print without showing a modal.
 */

import React from 'react'
import { Order, OrderItem } from '../types/order'
import { formatWeight } from '../lib/weight'
import { printKOTRaw } from '../lib/thermalPrinter'
import toast from 'react-hot-toast'

interface PrintKOTProps {
  order: Order
  items: OrderItem[]
  restaurantName?: string
  onClose: () => void
}

/** Print directly to the printer already connected from the Kitchen display. */
export async function printKOT(
  order: Order,
  items: OrderItem[],
  restaurantName = 'Kitchen',
  round?: number,
): Promise<boolean> {
  try {
    await printKOTRaw(order, items, restaurantName, round)
    toast.success('KOT sent to thermal printer')
    return true
  } catch (error: any) {
    const message = error?.message || 'Could not print KOT'
    toast.error(message)
    return false
  }
}

/**
 * KOT preview modal — shows the ticket before printing.
 * Useful for verifying before sending to printer.
 */
const PrintKOT: React.FC<PrintKOTProps> = ({ order, items, restaurantName = 'Kitchen', onClose }) => {
  const handlePrint = async () => {
    const printed = await printKOT(order, items, restaurantName)
    if (printed) onClose()
  }

  const fmtMods = (mods?: any[]) =>
    mods && mods.length > 0
      ? mods.map((m) => {
          const adj = Number(m.price_adjustment || 0)
          return `${m.modifier_option_name}${adj > 0 ? ` (+₹${adj})` : adj < 0 ? ` (-₹${Math.abs(adj)})` : ''}`
        }).join(', ')
      : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xs animate-slide-up">
        {/* Preview */}
        <div className="p-5 font-mono text-xs border-b border-gray-100">
          <div className="text-center mb-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">{restaurantName}</p>
            <p className="text-xs uppercase tracking-widest text-gray-400">Kitchen Order Ticket</p>
          </div>
          <div className="border-t border-dashed border-gray-300 my-2" />
          <div className="text-center mb-3">
            <p className="text-3xl font-bold tracking-wider">{order.order_number}</p>
            <p className="text-xs text-gray-500 mt-1">
              {order.table?.table_number ? `Table ${order.table.table_number}` : order.order_type}
              {' · '}{order.order_source}
            </p>
          </div>
          <div className="border-t border-dashed border-gray-300 my-2" />
          <div className="space-y-1.5">
            {items.map((item, i) => (
              <div key={i}>
                <div className="flex gap-2">
                  <span className="font-bold min-w-[1.5rem] shrink-0">{item.weight_grams ? formatWeight(item.weight_grams) : `${item.quantity}x`}</span>
                  <span className="font-bold">{item.menu_item_name || item.menu_item_id}</span>
                </div>
                {fmtMods(item.modifiers) && (
                  <p className="text-gray-500 ml-8 text-xs">{fmtMods(item.modifiers)}</p>
                )}
                {item.special_instructions && (
                  <p className="text-gray-500 ml-8 text-xs">📝 {item.special_instructions}</p>
                )}
              </div>
            ))}
          </div>
          {order.special_instructions && (
            <>
              <div className="border-t border-dashed border-gray-300 my-2" />
              <p className="text-xs"><strong>NOTE:</strong> {order.special_instructions}</p>
            </>
          )}
          <div className="border-t border-dashed border-gray-300 my-2" />
          <p className="text-center text-gray-400 text-xs">{new Date().toLocaleTimeString('en-IN')}</p>
        </div>

        {/* Actions */}
        <div className="p-4 flex gap-3">
          <button
            onClick={handlePrint}
            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            🖨️ Print KOT
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium rounded-xl transition-colors text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default PrintKOT
