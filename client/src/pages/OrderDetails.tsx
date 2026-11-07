import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import { Order, OrderItem, OrderStatus } from '../types/order'
import { formatCurrency, formatDate } from '../lib/utils'
import { formatWeight, ratePerKg } from '../lib/weight'
import Card from '../components/Card'
import Badge from '../components/Badge'
import Button from '../components/Button'
import Loading from '../components/Loading'
import PaymentForm from '../components/PaymentForm'
import AddItemsModal from '../components/AddItemsModal'
import PrintKOT from '../components/PrintKOT'
import PrintReceipt from '../components/PrintReceipt'
import { useGrandTotal } from '../lib/useBillTotal'
import { ArrowLeftIcon, CurrencyDollarIcon, PlusIcon, PrinterIcon, XMarkIcon } from '@heroicons/react/24/outline'

const STATUS_BADGE: Record<OrderStatus, { variant: any; label: string }> = {
  CREATED:   { variant: 'default',  label: 'Created' },
  ACCEPTED:  { variant: 'info',     label: 'Accepted' },
  PREPARING: { variant: 'warning',  label: 'Preparing' },
  READY:     { variant: 'success',  label: 'Ready to Pay' },
  COMPLETED: { variant: 'success',  label: 'Completed' },
  CANCELLED: { variant: 'error',    label: 'Cancelled' },
}

// Kitchen-only transitions; READY is completed via payment
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  CREATED:   'ACCEPTED',
  ACCEPTED:  'PREPARING',
  PREPARING: 'READY',
}

const OrderDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [addItemsOpen, setAddItemsOpen] = useState(false)
  const [kotOpen, setKotOpen] = useState(false)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const allItems: OrderItem[] = ((order as any)?.items || (order as any)?.order_items || []) as OrderItem[]
  const billItems = allItems.filter((item) => item.status !== 'CANCELLED')
  const grandTotal = useGrandTotal(order, billItems)

  const fetchAll = async () => {
    if (!id) return
    try {
      const orderRes = await api.get(`/orders/${id}`)
      const data = orderRes.data.data
      // Endpoint returns { order: {...enriched}, items: [...] }
      const enriched = data.order || data
      setOrder(enriched)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleCancelItem = async (item: OrderItem) => {
    if (!order || !item.id) return
    const itemName = item.menu_item_name || 'this item'
    let cancelQty = item.quantity
    // For multi-portion lines (not weight-based), ask how many to cancel
    if (item.quantity > 1 && !item.weight_grams) {
      const input = window.prompt(
        `${itemName}: ${item.quantity} portions on this order.\nHow many do you want to cancel? (1-${item.quantity})`,
        '1',
      )
      if (input === null) return
      const n = Number(input)
      if (!Number.isInteger(n) || n < 1 || n > item.quantity) {
        toast.error(`Enter a number between 1 and ${item.quantity}`)
        return
      }
      cancelQty = n
    }
    const wholeLine = cancelQty === item.quantity
    const lastActive = wholeLine && billItems.length <= 1
    const confirmText = !wholeLine
      ? `Cancel ${cancelQty} of ${item.quantity} ${itemName}? The other ${item.quantity - cancelQty} will remain on this order.`
      : lastActive
        ? `Cancel ${itemName}? This is the last active item, so the order will also be closed.`
        : `Cancel ${itemName} only? The other ${billItems.length - 1} item(s) will remain on this order.`
    if (!window.confirm(confirmText)) return
    setUpdating(true)
    try {
      await api.patch(`/orders/${order.id}/items/${item.id}`, wholeLine ? { status: 'CANCELLED' } : { status: 'CANCELLED', cancel_quantity: cancelQty })
      toast.success(wholeLine ? `${itemName} cancelled` : `${cancelQty} × ${itemName} cancelled`)
      await fetchAll()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setUpdating(false)
    }
  }

  const handleStatusUpdate = async (newStatus: OrderStatus) => {
    if (!order) return
    setUpdating(true)
    try {
      await api.patch(`/orders/${order.id}`, { status: newStatus })
      setOrder({ ...order, status: newStatus })
      toast.success(`Order ${newStatus.toLowerCase()}`)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setUpdating(false)
    }
  }

  if (loading) return <Loading text="Loading order…" />
  if (!order) return (
    <div className="text-center py-16">
      <p className="text-gray-500">Order not found.</p>
      <Button variant="outline" className="mt-4" onClick={() => navigate('/orders')}>
        Back to Orders
      </Button>
    </div>
  )

  const badge = STATUS_BADGE[order.status]
  const nextStatus = NEXT_STATUS[order.status]
  const items: OrderItem[] = (order as any).items || (order as any).order_items || []
  const isActive = !['COMPLETED', 'CANCELLED'].includes(order.status)

  return (
    <div className="space-y-5 animate-fade-in max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/orders')}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{order.order_number}</h1>
            <Badge variant={badge.variant} dot>{badge.label}</Badge>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Created {formatDate(order.created_at)}</p>
        </div>
        {isActive && (
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="primary"
              leftIcon={<PlusIcon className="w-4 h-4" />}
              onClick={() => setAddItemsOpen(true)}
            >
              Add Items
            </Button>
            {/* READY → single Collect Payment action; no advance button */}
            {order.status === 'READY' ? (
              <Button
                variant="primary"
                leftIcon={<CurrencyDollarIcon className="w-4 h-4" />}
                onClick={() => setPaymentOpen(true)}
              >
                Collect Payment
              </Button>
            ) : nextStatus ? (
              <Button
                variant="secondary"
                isLoading={updating}
                onClick={() => handleStatusUpdate(nextStatus)}
              >
                Mark {nextStatus}
              </Button>
            ) : null}
            {order.status !== 'READY' && (
              <Button
                variant="outline"
                leftIcon={<CurrencyDollarIcon className="w-4 h-4" />}
                onClick={() => setPaymentOpen(true)}
              >
                Collect Payment
              </Button>
            )}
            <Button
              variant="danger"
              isLoading={updating}
              onClick={() => handleStatusUpdate('CANCELLED')}
            >
              Cancel
            </Button>
          </div>
        )}
        {/* Print buttons — always visible */}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<PrinterIcon className="w-4 h-4" />}
            onClick={() => setKotOpen(true)}
            title="Print Kitchen Order Ticket"
          >
            KOT
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<PrinterIcon className="w-4 h-4" />}
            onClick={() => setReceiptOpen(true)}
            title="Print Customer Receipt"
          >
            Receipt
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Order info */}
        <Card className="md:col-span-1">
          <h2 className="font-semibold text-gray-900 mb-4">Order Info</h2>
          <dl className="space-y-3 text-sm">
            {[
              { label: 'Order #', value: order.order_number },
              { label: 'Type', value: order.order_type },
              { label: 'Source', value: order.order_source },
              { label: 'Table', value: order.table?.table_number ? `Table ${order.table.table_number}${(order as any).guest_label ? ` · Guest ${(order as any).guest_label}` : ''}` : '—' },
              { label: 'Total', value: formatCurrency(grandTotal ?? Number(order.total_amount || 0)) },
              { label: 'Priority', value: order.priority_score },
              { label: 'Updated', value: formatDate(order.updated_at) },
              ...(order.completed_at ? [{ label: 'Completed', value: formatDate(order.completed_at) }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between">
                <dt className="text-gray-500">{label}</dt>
                <dd className="font-medium text-gray-900 text-right">{String(value)}</dd>
              </div>
            ))}
          </dl>
          {order.special_instructions && (
            <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
              <p className="text-xs font-medium text-amber-700 mb-1">Special Instructions</p>
              <p className="text-sm text-amber-800">{order.special_instructions}</p>
            </div>
          )}
        </Card>

        {/* Items */}
        <Card className="md:col-span-2">
          <h2 className="font-semibold text-gray-900 mb-4">
            Order Items <span className="text-gray-400 font-normal">({billItems.length} active)</span>
          </h2>
          {items.length === 0 ? (
            <p className="text-gray-400 text-sm">No items</p>
          ) : (
            <div className="space-y-3">
              {items.map((item, i) => {
                const unitPrice = Number(item.unit_price || 0)
                return (
                  <div
                    key={item.id || i}
                    className="flex items-start gap-4 p-3 bg-gray-50 rounded-xl"
                  >
                    <div className={`h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0 ${item.weight_grams ? 'px-2 min-w-[2rem]' : 'w-8'}`}>
                      <span className="text-indigo-700 font-bold text-sm whitespace-nowrap">{item.weight_grams ? formatWeight(item.weight_grams) : item.quantity}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">
                        {item.menu_item_name || item.menu_item_id}
                      </p>
                      {item.special_instructions && (
                        <p className="text-xs text-amber-600 mt-0.5">📝 {item.special_instructions}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-semibold ${item.status === 'CANCELLED' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                        {formatCurrency(unitPrice * item.quantity)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {item.weight_grams ? `${formatCurrency(ratePerKg(unitPrice, item.weight_grams))} / kg` : `${formatCurrency(unitPrice)} each`}
                      </p>
                      {item.status === 'CANCELLED' ? (
                        <span className="text-xs font-semibold text-red-600">Cancelled</span>
                      ) : isActive ? (
                        <button type="button" disabled={updating} onClick={() => handleCancelItem(item)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50">
                          <XMarkIcon className="w-3.5 h-3.5" /> Cancel item
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}

              {/* Total */}
              <div className="flex justify-between items-center pt-3 border-t border-gray-200">
                <span className="font-semibold text-gray-900">Total</span>
                <span className="text-xl font-bold text-indigo-600">
                  {formatCurrency(grandTotal ?? Number(order.total_amount || 0))}
                </span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {paymentOpen && (
        <PaymentForm
          orderId={order.id}
          onClose={() => setPaymentOpen(false)}
          onPaymentSuccess={() => {
            setPaymentOpen(false)
            toast.success('Payment recorded')
          }}
        />
      )}

      {addItemsOpen && (
        <AddItemsModal
          orderId={order.id}
          orderNumber={order.order_number}
          onClose={() => setAddItemsOpen(false)}
          onAdded={() => {
            setAddItemsOpen(false)
            fetchAll()
          }}
        />
      )}

      {kotOpen && (
        <PrintKOT
          order={order}
          items={items.filter((item) => item.status !== 'CANCELLED')}
          onClose={() => setKotOpen(false)}
        />
      )}

      {receiptOpen && (
        <PrintReceipt
          order={order}
          items={items.filter((item) => item.status !== 'CANCELLED')}
          onClose={() => setReceiptOpen(false)}
        />
      )}
    </div>
  )
}

export default OrderDetails
