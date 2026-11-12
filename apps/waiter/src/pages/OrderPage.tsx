/**
 * OrderPage — the main order-taking screen.
 * Menu grid on top, cart summary at bottom.
 * Supports both new orders and adding to existing orders.
 */

import { autoPrintAfterOrder } from '../lib/kotPrinter'
import { useEffect, useLayoutEffect, useState, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { PlusIcon, MinusIcon, ShoppingCartIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useMenuStore } from '../store/useMenuStore'
import { useCartStore } from '../store/useCartStore'
import { useOrderStore } from '../store/useOrderStore'
import { ordersApi } from '../api/endpoints'
import { getErrorMessage } from '../api/client'
import type { MenuItem } from '../types'
import { searchMenu } from '../lib/menuSearch'
import WeightEntryModal from '../components/WeightEntryModal'
import { isWeighed, priceUnitSuffix, weightedAmount, formatWeight, PriceUnit } from '../lib/weight'

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n)

const OrderPage: React.FC = () => {
  const navigate = useNavigate()
  const { orderId } = useParams<{ orderId?: string }>()  // set when adding to existing order
  const [searchParams] = useSearchParams()
  const tableLabel = searchParams.get('table')
  const guestLabel = searchParams.get('guest')

  const isAddMode = !!orderId
  // The cart belongs to ONE table / order. Opening a different one starts with an empty cart.
  const contextKey = isAddMode ? `add:${orderId}` : `new:${tableLabel || 'pickup'}:${guestLabel || ''}`

  const { categories, items, fetchAll, setReadyStock } = useMenuStore()
  const { cart, begin, tableNumber, orderType, notes, addItem, changeQty, removeItem, setNote, setWeight, setNotes, clear, total, count } = useCartStore()
  const { submitOrder } = useOrderStore()

  const [activeCat, setActiveCat] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [noteOpen, setNoteOpen] = useState<string | null>(null)   // line_id of the line whose note is open
  // Item waiting for its weight / piece count (lineId set = editing the weight of that cart line)
  const [weightFor, setWeightFor] = useState<{ item: MenuItem; lineId?: string } | null>(null)

  useEffect(() => { fetchAll() }, [fetchAll])

  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  // While typing, search the whole menu (best match first); otherwise show the chosen category
  const filtered = useMemo(() => {
    if (search.trim()) return searchMenu(items, search, categoryNameById)
    return items.filter((item) =>
      activeCat === 'ALL' || (item.category_ids?.length ? item.category_ids : [item.category_id]).includes(activeCat),
    )
  }, [items, activeCat, search, categoryNameById])

  // Ready-made item: batch finished -> orders for it go to the kitchen; restocked -> straight to the waiter
  const handleToggleBatch = async (item: MenuItem) => {
    const inStock = item.ready_in_stock !== false
    try {
      await setReadyStock(item.id, !inStock)
      toast.success(inStock ? `${item.name}: out of batch — goes to kitchen` : `${item.name}: ready-made again`)
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  const handleAdd = (item: MenuItem) => {
    // Sold by kg / 100 g: ask for the weight (or number of pieces) first
    if (isWeighed(item.price_unit)) {
      setWeightFor({ item })
      return
    }
    addItem({ menu_item_id: item.id, name: item.name, price: item.price, quantity: 1 })
  }

  // Weight entered: add a new weighed line, or change the weight of an existing one
  const confirmWeight = (grams: number) => {
    if (!weightFor) return
    const { item, lineId } = weightFor
    const amount = weightedAmount(Number(item.price), item.price_unit as PriceUnit, grams)
    if (lineId) {
      setWeight(lineId, grams, amount)
    } else {
      addItem({
        menu_item_id: item.id,
        name: item.name,
        price: amount,
        quantity: 1,
        weight_grams: grams,
        price_unit: item.price_unit as 'KG' | '100G',
        unit_rate: Number(item.price),
      })
    }
    setWeightFor(null)
  }

  // Item sold by weight AND by piece: add it as a normal by-piece line (quantity x piece price)
  const confirmPiece = (quantity: number) => {
    if (!weightFor) return
    const { item } = weightFor
    const piecePrice = Number(item.piece_price)
    if (!(piecePrice > 0)) return
    addItem({ menu_item_id: item.id, name: item.name, price: piecePrice, quantity })
    setWeightFor(null)
  }

  // Enter in the search box adds the top match when there is exactly one
  const handleSearchEnter = () => {
    if (filtered.length === 1) {
      const only = filtered[0]
      handleAdd(only)
      if (!isWeighed(only.price_unit)) {
        toast.success(`Added ${only.name}`, { duration: 1200 })
        setSearch('')
      }
    }
  }

  const handleSubmit = async () => {
    if (cart.length === 0) { toast.error('Add at least one item'); return }
    setSubmitting(true)

    try {
      if (isAddMode && orderId) {
        // Add items to existing order
        await ordersApi.addItems(orderId, cart)
        autoPrintAfterOrder(orderId)
        toast.success(`Added ${count()} item(s) to order`)
        clear()
        navigate('/orders')
      } else {
        // Create new order (supports offline queue)
        const { tableId } = useCartStore.getState()
        const order = await submitOrder({
          table_id:    tableId,
          guest_label: searchParams.get('guest') || undefined,
          order_type:  orderType,
          order_source: 'WAITER',
          special_instructions: notes || undefined,
          items: cart.map((c) => ({
            menu_item_id: c.menu_item_id,
            quantity: c.quantity,
            special_instructions: c.special_instructions,
            weight_grams: c.weight_grams,
          })),
        })

        if (order) {
          autoPrintAfterOrder(order.id)
          toast.success(`Order ${order.order_number} created`)
        } else {
          toast.success('Order queued — will sync when online', { icon: '📶' })
        }
        clear()
        navigate('/orders')
      }
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const cartCount = count()
  const cartTotal = total()

  useEffect(() => { if (reviewing && cart.length === 0) setReviewing(false) }, [reviewing, cart.length])

  // Runs before the screen is drawn, so items from another table never flash on screen
  useLayoutEffect(() => { begin(contextKey) }, [begin, contextKey])

  // Cancel / Back: unsent items are discarded (after a quick confirmation if there are any)
  const [discardOpen, setDiscardOpen] = useState(false)
  const handleCancel = () => {
    if (cart.length > 0) { setDiscardOpen(true); return }
    clear()
    navigate(-1)
  }
  const discardAndLeave = () => {
    setDiscardOpen(false)
    clear()
    navigate(-1)
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-gray-900">
              {isAddMode ? 'Add Items' : 'New Order'}
            </h1>
            <p className="text-xs text-gray-500">
              {isAddMode
                ? `Adding to order · Table ${tableLabel || ''}${guestLabel ? ` · Guest ${guestLabel}` : ''}`
                : tableNumber ? `Table ${tableNumber}${guestLabel ? ` · Guest ${guestLabel}` : ''}` : (orderType === 'PARCEL' ? 'Pick-up' : orderType)}
            </p>
          </div>
          <button onClick={handleCancel} className="text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search dishes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearchEnter() }}
          enterKeyHint="done"
          className="input mt-2 text-sm"
        />

        {/* Category chips */}
        <div className="flex gap-2 overflow-x-auto mt-2 pb-1 scrollbar-none">
          {['ALL', ...categories.map((c) => c.name)].map((cat) => {
            const catId = cat === 'ALL' ? 'ALL' : categories.find((c) => c.name === cat)?.id || cat
            return (
              <button
                key={cat}
                onClick={() => setActiveCat(catId)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                  activeCat === catId
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {cat}
              </button>
            )
          })}
        </div>
      </div>

      {/* Menu grid */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filtered.map((item) => {
          const weighed = isWeighed(item.price_unit)
          const itemLines = cart.filter((c) => c.menu_item_id === item.id)
          // Normal items get a - qty + stepper; by-weight items always open the weight popup instead
          const inCart = weighed ? undefined : itemLines[0]
          const hasPiece = weighed && Number(item.piece_price) > 0
          return (
            <div key={item.id} className="card p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {item.is_vegetarian && (
                    <span className="w-3.5 h-3.5 rounded border-2 border-emerald-500 flex items-center justify-center shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    </span>
                  )}
                  <p className="font-medium text-gray-900 text-sm truncate">{item.name}</p>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-indigo-600 font-bold text-sm">
                    {formatCurrency(item.price)}
                    {weighed && <span className="text-xs font-medium"> {priceUnitSuffix(item.price_unit)}</span>}
                  </p>
                  {hasPiece && (
                    <span className="text-xs text-gray-500">· {formatCurrency(Number(item.piece_price))} / piece</span>
                  )}
                  {item.skip_kitchen && (
                    <button
                      type="button"
                      onClick={() => handleToggleBatch(item)}
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                        item.ready_in_stock === false
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      }`}
                    >
                      {item.ready_in_stock === false ? '🍳 Out of batch' : '⚡ Ready-made'}
                    </button>
                  )}
                </div>
                {weighed && itemLines.length > 0 && (
                  <p className="text-xs text-indigo-600 mt-0.5">
                    In order: {itemLines.map((l) => (l.weight_grams ? formatWeight(l.weight_grams) : `${l.quantity} pc`)).join(' · ')}
                  </p>
                )}
              </div>

              {inCart ? (
                <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden shrink-0">
                  <button
                    onClick={() => changeQty(inCart.line_id, -1)}
                    className="px-3 py-2 hover:bg-gray-100 text-gray-600"
                  >
                    <MinusIcon className="w-4 h-4" />
                  </button>
                  <span className="px-2 font-bold text-sm min-w-[24px] text-center">{inCart.quantity}</span>
                  <button
                    onClick={() => handleAdd(item)}
                    className="px-3 py-2 hover:bg-gray-100 text-gray-600"
                  >
                    <PlusIcon className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleAdd(item)}
                  className="w-9 h-9 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shrink-0 transition-colors"
                >
                  <PlusIcon className="w-5 h-5" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Review bar */}
      <div className="px-4 pb-6 pt-2 shrink-0 bg-white border-t border-gray-100">
        <button
          onClick={() => setReviewing(true)}
          disabled={cartCount === 0}
          className="btn-primary w-full flex items-center justify-between"
        >
          <span className="bg-indigo-500 rounded-lg px-2 py-0.5 text-sm">{cartCount}</span>
          <span>Review Order</span>
          <span>{formatCurrency(cartTotal)}</span>
        </button>
      </div>

      {/* Review sheet — waiter checks everything before it is sent */}
      {reviewing && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => !submitting && setReviewing(false)}>
          <div
            className="bg-white w-full rounded-t-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-3 border-b border-gray-100 shrink-0">
              <h2 className="font-bold text-gray-900">Review order</h2>
              <p className="text-xs text-gray-500">
                {isAddMode
                  ? `Adding to order · Table ${tableLabel || ''}`
                  : tableNumber ? `Table ${tableNumber}${guestLabel ? ` · Guest ${guestLabel}` : ''}` : orderType}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-2 divide-y divide-gray-100">
              {cart.map((line) => (
                <div key={line.line_id} className="py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{line.name}</p>
                    <p className="text-xs text-gray-500">
                      {line.weight_grams
                        ? `${formatWeight(line.weight_grams)} × ${formatCurrency(line.unit_rate || 0)} ${priceUnitSuffix(line.price_unit)}`
                        : `${formatCurrency(line.price)} × ${line.quantity}`}
                      {' = '}<span className="font-semibold text-gray-800">{formatCurrency(line.price * line.quantity)}</span>
                    </p>
                    {noteOpen === line.line_id ? (
                      <div className="mt-1.5 space-y-1.5">
                        <input
                          type="text"
                          autoFocus
                          value={line.special_instructions || ''}
                          onChange={(e) => setNote(line.line_id, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') setNoteOpen(null) }}
                          placeholder="e.g. less spicy, no onion"
                          className="input text-xs py-1.5"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          {['Less spicy', 'Extra spicy', 'No onion', 'Less oil'].map((q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => {
                                const cur = line.special_instructions || ''
                                if (!cur.toLowerCase().includes(q.toLowerCase())) setNote(line.line_id, cur ? `${cur}, ${q}` : q)
                              }}
                              className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px]"
                            >
                              {q}
                            </button>
                          ))}
                          <button type="button" onClick={() => setNoteOpen(null)} className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[11px]">
                            Done
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setNoteOpen(line.line_id)}
                        className={`text-xs mt-0.5 ${line.special_instructions ? 'text-amber-600' : 'text-indigo-600'}`}
                      >
                        {line.special_instructions ? `Note: ${line.special_instructions} · edit` : '+ Add note'}
                      </button>
                    )}
                  </div>
                  {line.weight_grams ? (
                    <button
                      type="button"
                      onClick={() => {
                        const item = items.find((i) => i.id === line.menu_item_id)
                        if (item) setWeightFor({ item, lineId: line.line_id })
                      }}
                      className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-medium text-indigo-600 shrink-0"
                    >
                      Edit weight
                    </button>
                  ) : (
                    <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden shrink-0">
                      <button onClick={() => changeQty(line.line_id, -1)} className="px-2.5 py-1.5 text-gray-600">
                        <MinusIcon className="w-4 h-4" />
                      </button>
                      <span className="px-2 font-bold text-sm min-w-[24px] text-center">{line.quantity}</span>
                      <button onClick={() => changeQty(line.line_id, 1)} className="px-2.5 py-1.5 text-gray-600">
                        <PlusIcon className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <button onClick={() => removeItem(line.line_id)} className="p-1.5 text-red-500" aria-label={`Remove ${line.name}`}>
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {!isAddMode && (
                <div className="py-3">
                  <label className="text-xs text-gray-500" htmlFor="order-note">Order note (for the whole order)</label>
                  <input
                    id="order-note"
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. serve together, birthday table"
                    className="input text-sm mt-1"
                  />
                </div>
              )}
            </div>

            <div className="px-4 pb-6 pt-3 border-t border-gray-100 shrink-0 space-y-2">
              <div className="flex justify-between text-sm font-semibold text-gray-900">
                <span>{cartCount} item{cartCount === 1 ? '' : 's'}</span>
                <span>{formatCurrency(cartTotal)}</span>
              </div>
              <button
                onClick={handleSubmit}
                disabled={submitting || cartCount === 0}
                className="btn-primary w-full"
              >
                {submitting ? 'Sending…' : isAddMode ? 'Confirm & Add to Order' : 'Confirm & Place Order'}
              </button>
              <button
                onClick={() => setReviewing(false)}
                disabled={submitting}
                className="w-full text-sm text-gray-600 py-2"
              >
                Back to menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discard confirmation */}
      {discardOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center sm:p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDiscardOpen(false)} />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-sm p-5 pb-8 sm:pb-5">
            <h3 className="font-bold text-gray-900">Discard this order?</h3>
            <p className="text-sm text-gray-500 mt-1">
              {cartCount} item{cartCount === 1 ? '' : 's'} not sent to the kitchen will be removed.
            </p>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setDiscardOpen(false)}
                className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-700"
              >
                Keep editing
              </button>
              <button
                onClick={discardAndLeave}
                className="flex-1 py-3 bg-red-600 text-white rounded-xl text-sm font-semibold"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Weight / pieces popup for items sold by kg or 100 g */}
      {weightFor && (
        <WeightEntryModal
          itemName={weightFor.item.name}
          price={Number(weightFor.item.price)}
          unit={weightFor.item.price_unit as PriceUnit}
          initialGrams={weightFor.lineId ? cart.find((c) => c.line_id === weightFor.lineId)?.weight_grams : undefined}
          piecePrice={!weightFor.lineId && Number(weightFor.item.piece_price) > 0 ? Number(weightFor.item.piece_price) : undefined}
          onConfirmPiece={confirmPiece}
          onConfirm={confirmWeight}
          onClose={() => setWeightFor(null)}
        />
      )}
    </div>
  )
}

export default OrderPage
