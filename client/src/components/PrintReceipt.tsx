/**
 * PrintReceipt — customer bill / receipt.
 *
 * Uses the SAME bill as the Bill screen (lib/billPrint.ts), so every print
 * button in the app produces an identical bill: GST split, service charge,
 * discount / coupon, UPI + review QR, restaurant details.
 */

import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Order, OrderItem } from '../types/order'
import { buildBillDocument, loadBillData, printBill } from '../lib/billPrint'
import { getErrorMessage } from '../api'
import PrinterConnect from './PrinterConnect'

interface PrintReceiptProps {
  order: Order
  items?: OrderItem[]
  restaurantName?: string
  paymentMethod?: string
  onClose: () => void
}

/** Print the bill directly (no preview). Extra args kept so old callers still compile. */
export function printReceipt(
  order: Order,
  _items?: OrderItem[],
  _restaurantName?: string,
  _paymentMethod?: string,
): void {
  printBill(order.id).catch((err) => toast.error(getErrorMessage(err)))
}

/** Receipt preview modal — shows the exact bill that will be printed. */
const PrintReceipt: React.FC<PrintReceiptProps> = ({ order, onClose }) => {
  const [doc, setDoc] = useState<string | null>(null)

  useEffect(() => {
    loadBillData(order.id)
      .then((data) => setDoc(buildBillDocument(data)))
      .catch((err) => { toast.error(getErrorMessage(err)); onClose() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

  const handlePrint = () => {
    printReceipt(order)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-slide-up">
        <div className="border-b border-gray-100">
          {doc ? (
            <iframe title="Bill preview" srcDoc={doc} className="w-full h-[65vh] rounded-t-2xl bg-white" />
          ) : (
            <div className="h-40 flex items-center justify-center text-sm text-gray-400">Loading bill…</div>
          )}
        </div>
        <div className="px-4 pt-3"><PrinterConnect /></div>
        <div className="p-4 flex gap-3">
          <button
            onClick={handlePrint}
            disabled={!doc}
            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            🖨️ Print Bill
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

export default PrintReceipt
