/**
 * CustomerApp — public QR ordering page.
 * No login required. Supports two modes:
 *   - restaurant: customer enters table number, pays at counter
 *   - mall:       customer enters name + phone, picks payment method
 *
 * URL: /customer?slug=demo-kitchen
 * URL (scanned table QR): /customer?slug=demo-kitchen&t=<qr_token>
 */

import { useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { MenuItem, MenuCategory } from '../types/menu'
import { formatCurrency } from '../lib/utils'
import { optimizeImageUrl } from '../lib/imageUpload'
import {
  ShoppingCartIcon,
  PlusIcon,
  MinusIcon,
  MagnifyingGlassIcon,
  CheckCircleIcon,
  XMarkIcon,
  ChevronRightIcon,
  BellAlertIcon,
  BanknotesIcon,
  SparklesIcon,
  ArrowUpIcon,
  Bars3Icon,
} from '@heroicons/react/24/outline'
import { calcBill, normalizeBilling, LEGACY_BILLING, type BillingSettings } from '../lib/billing'
import {
  CustomerMenuDrawer,
  LiveOrderBanner,
  saveCustomerOrder,
  useTrackedOrders,
  type OrdersView,
  type SavedOrderLine,
} from '../components/CustomerMenuDrawer'

// ── Dedicated public API — no auth token, no logout interceptor ──────────────
const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  timeout: 15000,
})

type QRMode = 'restaurant' | 'mall'
type PaymentMethod = 'CASH' | 'CARD' | 'UPI' | 'ONLINE'
type Step = 'info' | 'pin' | 'menu' | 'cart' | 'confirm'
type DietFilter = 'ALL' | 'VEG' | 'NONVEG'

// Tap to filter the menu; tap the active one again to clear it.
const DIET_OPTIONS: { value: 'VEG' | 'NONVEG'; label: string; dot: string }[] = [
  { value: 'VEG', label: 'Veg', dot: 'bg-emerald-600' },
  { value: 'NONVEG', label: 'Non-veg', dot: 'bg-red-600' },
]
const matchesDiet = (diet: DietFilter, isVeg: boolean) =>
  diet === 'ALL' || (diet === 'VEG' ? isVeg : !isVeg)

// ── Modifier types ───────────────────────────────────────────────────────────

interface ModifierOption {
  id: string
  name: string
  price_adjustment: number
  sort_order: number
}

interface ModifierGroup {
  id: string
  name: string
  selection_type: 'single' | 'multiple'
  min_select: number
  max_select: number
  sort_order: number
  options: ModifierOption[]
}

interface SelectedModifier {
  group_id: string
  group_name: string
  option_id: string
  option_name: string
  price_adjustment: number
}

interface CartLine {
  cart_key: string         // composite key for unique cart identity
  id: string               // menu_item_id
  name: string
  price: number            // base unit price (excl modifiers)
  quantity: number
  is_vegetarian: boolean
  modifiers: SelectedModifier[]
}

interface Table {
  id: string
  table_number: string
  seats: number
}

interface OrderConfirmation {
  order_number: string
  total_amount: number
  items_count: number
  payment_method: PaymentMethod
  qr_mode: QRMode
  /** Final amount incl. GST and charges, as shown in the cart when the order was placed */
  payable_total?: number
}

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string; icon: string; desc: string }[] = [
  { value: 'UPI',    label: 'UPI',           icon: '📱', desc: 'Google Pay, PhonePe, Paytm' },
  { value: 'CARD',   label: 'Card',          icon: '💳', desc: 'Debit or Credit card' },
  { value: 'ONLINE', label: 'Online',        icon: '🌐', desc: 'Net banking / Wallet' },
  { value: 'CASH',   label: 'Pay at Counter',icon: '💵', desc: 'Pay when you collect' },
]

// How long the Call Waiter / Request Bill buttons stay disabled after a
// successful tap, so a customer can't spam the waiter app.
const REQUEST_COOLDOWN_MS = 60000

// Restaurant accent colour: uses the colour set in Branding, darkened a little
// so white text stays readable. Falls back to a warm orange.
const DEFAULT_ACCENT = '#ea580c'
const darkenHex = (hex: string, amount: number): string => {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.max(0, Math.round(v * (1 - amount)))
  const parts = [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)]
  return '#' + parts.map((v) => v.toString(16).padStart(2, '0')).join('')
}

// ── Cart persistence ─────────────────────────────────────────────────────────
// Keep the cart in the browser so a page refresh doesn't empty it. Saved per
// restaurant + table QR, and dropped after 6 hours so an old cart never lingers.
const CART_TTL_MS = 6 * 60 * 60 * 1000
const cartStorageKey = (slug: string, qrToken: string) =>
  `auraos_cart:${slug}:${qrToken || 'none'}`

function loadSavedCart(key: string): CartLine[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.cart) || Date.now() - parsed.savedAt > CART_TTL_MS) {
      localStorage.removeItem(key)
      return []
    }
    return parsed.cart as CartLine[]
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const CustomerApp: React.FC = () => {
  const [searchParams] = useSearchParams()
  const slug = searchParams.get('slug') || 'demo-kitchen'
  const qrToken = searchParams.get('t') || ''

  // Data
  const [restaurantName, setRestaurantName] = useState('Restaurant')
  const [brand, setBrand] = useState<{ logo_url: string; hero_image_url: string; tagline: string; accent_color: string }>({
    logo_url: '', hero_image_url: '', tagline: '', accent_color: '',
  })
  const [showTop, setShowTop] = useState(false)
  const [qrMode, setQrMode] = useState<QRMode>('restaurant')
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [tables, setTables] = useState<Table[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Customer info (restaurant mode)
  const [tableId, setTableId] = useState<string>('')
  const [tableNumber, setTableNumber] = useState<string>('')
  const [tableLocked, setTableLocked] = useState(false)   // true once table is auto-picked from a scanned QR
  const [tablePasscode, setTablePasscode] = useState('')  // verified PIN, sent along with the order
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [verifyingPin, setVerifyingPin] = useState(false)

  // Call Waiter / Request Bill
  const [callingWaiter, setCallingWaiter] = useState(false)
  const [requestingBill, setRequestingBill] = useState(false)
  const [waiterCooldown, setWaiterCooldown] = useState(false)
  const [billCooldown, setBillCooldown] = useState(false)
  const [requestError, setRequestError] = useState('')

  // Customer info (mall mode)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')

  // Menu
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>(() => loadSavedCart(cartStorageKey(slug, qrToken)))

  // Coupon (customer-entered)
  const [couponCode, setCouponCode] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discount: number } | null>(null)
  const [couponMsg, setCouponMsg] = useState('')
  const [couponBusy, setCouponBusy] = useState(false)

  // Modifier selection modal
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null)
  const [modifierSelections, setModifierSelections] = useState<Record<string, string | string[]>>({})
  const [modifierQuantity, setModifierQuantity] = useState(1)

  // UI state
  const [step, setStep] = useState<Step>('info')
  const [cartOpen, setCartOpen] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [confirmation, setConfirmation] = useState<OrderConfirmation | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [ordersView, setOrdersView] = useState<OrdersView | null>(null)
  const tracked = useTrackedOrders(slug)
  const [notice, setNotice] = useState('')
  const [diet, setDiet] = useState<DietFilter>('ALL')
  const [billing, setBilling] = useState<BillingSettings>(LEGACY_BILLING)
  const [ratingSummary, setRatingSummary] = useState<{ count: number; average: number } | null>(null)
  const [infoError, setInfoError] = useState('')

  // ── Build a flat modifier options lookup from the menu items ────────────────
  const itemModifierGroups = useMemo(() => {
    const map: Record<string, ModifierGroup[]> = {}
    for (const item of items) {
      if ((item as any).modifier_groups && (item as any).modifier_groups.length > 0) {
        map[item.id] = (item as any).modifier_groups
      }
    }
    return map
  }, [items])

  // ── Save the cart whenever it changes (empty cart clears the saved copy) ───
  useEffect(() => {
    const key = cartStorageKey(slug, qrToken)
    try {
      if (cart.length === 0) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), cart }))
    } catch {
      // Storage unavailable (e.g. private mode) — cart just won't survive a refresh.
    }
  }, [cart, slug, qrToken])

  // ── Load menu + tables ─────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      publicApi.get(`/public/menu/${slug}`),
      publicApi.get(`/public/tables/${slug}`),
    ])
      .then(([menuRes, tablesRes]) => {
        const data = menuRes.data.data
        setRestaurantName(data.restaurant.name)
        setBrand({
          logo_url: data.restaurant.logo_url || '',
          hero_image_url: data.restaurant.hero_image_url || '',
          tagline: data.restaurant.tagline || '',
          accent_color: data.restaurant.accent_color || '',
        })
        setQrMode(data.restaurant.qr_mode || 'restaurant')
        setBilling(normalizeBilling(data.restaurant.billing))
        setCategories(data.categories || [])
        setItems(data.items || [])
        // Remove any restored cart lines whose dish is no longer on the menu
        const menuIds = new Set((data.items || []).map((i: any) => i.id))
        setCart((prev) => prev.filter((c) => menuIds.has(c.id)))
        setTables(tablesRes.data.data || [])
      })
      .catch((err) => {
        setError(err.response?.data?.error?.message || err.message || 'Failed to load menu')
      })
      .finally(() => setLoading(false))
  }, [slug])

  // ── Restaurant rating (shown under the name; optional) ─────────────────────
  useEffect(() => {
    publicApi.get(`/public/site/${slug}/rating`)
      .then((res) => {
        const d = res.data?.data
        if (d && Number(d.count) > 0) setRatingSummary({ count: Number(d.count), average: Number(d.average) })
      })
      .catch(() => { /* the rating badge is optional */ })
  }, [slug])

  // Hide the small notice message after a few seconds
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(t)
  }, [notice])

  // ── Resolve table from a scanned per-table QR code ───────────────────────
  useEffect(() => {
    if (!qrToken) return
    publicApi.get(`/public/tables/${slug}/qr/${qrToken}`)
      .then((res) => {
        const t = res.data.data
        setTableId(t.id)
        setTableNumber(t.table_number)
        setTableLocked(true)
        setStep('pin')
      })
      .catch((err) => {
        setError(err.response?.data?.error?.message || 'This QR code is invalid or the table is no longer active')
      })
  }, [qrToken, slug])

  // ── Verify the table PIN before letting the customer see the menu ────────
  const handleVerifyPin = async () => {
    if (!pinInput.trim()) {
      setPinError('Enter the PIN printed on your table')
      return
    }
    setVerifyingPin(true)
    setPinError('')
    try {
      await publicApi.post(`/public/tables/${slug}/verify-passcode`, {
        table_id: tableId,
        passcode: pinInput.trim(),
      })
      setTablePasscode(pinInput.trim())
      setStep('menu')
    } catch (err: any) {
      setPinError(err.response?.data?.error?.message || 'Incorrect PIN — please try again')
    } finally {
      setVerifyingPin(false)
    }
  }

  // ── Call Waiter / Request Bill ────────────────────────────────────────────
  const handleCallWaiter = async () => {
    if (!tableId || callingWaiter || waiterCooldown) return
    setCallingWaiter(true)
    setRequestError('')
    try {
      await publicApi.post(`/public/tables/${slug}/call-waiter`, { table_id: tableId })
      setWaiterCooldown(true)
      setTimeout(() => setWaiterCooldown(false), REQUEST_COOLDOWN_MS)
    } catch (err: any) {
      setRequestError(err.response?.data?.error?.message || 'Could not reach the waiter — please try again')
    } finally {
      setCallingWaiter(false)
    }
  }

  const handleRequestBill = async () => {
    if (!tableId || requestingBill || billCooldown) return
    setRequestingBill(true)
    setRequestError('')
    try {
      await publicApi.post(`/public/tables/${slug}/request-bill`, { table_id: tableId })
      setBillCooldown(true)
      setTimeout(() => setBillCooldown(false), REQUEST_COOLDOWN_MS)
    } catch (err: any) {
      setRequestError(err.response?.data?.error?.message || 'Could not request the bill — please try again')
    } finally {
      setRequestingBill(false)
    }
  }

  // ── Filtered menu ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return items.filter((item) => {
      const matchCat = selectedCategory === 'ALL' || item.category_id === selectedCategory
      const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase())
      return matchCat && matchSearch && matchesDiet(diet, item.is_vegetarian)
    })
  }, [items, selectedCategory, search, diet])

  // ── Look & feel data ───────────────────────────────────────────────────────
  const accent = useMemo(
    () => (/^#[0-9a-fA-F]{6}$/.test(brand.accent_color) ? darkenHex(brand.accent_color, 0.12) : DEFAULT_ACCENT),
    [brand.accent_color],
  )
  const accentStyle = { '--accent': accent } as React.CSSProperties

  // Big photo cards at the top: only items marked Featured that have a photo
  const featuredItems = useMemo(
    () => items.filter((i) => i.is_featured && i.image_url && matchesDiet(diet, i.is_vegetarian)),
    [items, diet],
  )

  // Menu list grouped by category, in category order
  const sections = useMemo(() => {
    const result = categories
      .map((cat) => ({ id: cat.id, name: cat.name, list: filtered.filter((i) => i.category_id === cat.id) }))
      .filter((sec) => sec.list.length > 0)
    const known = new Set(categories.map((c) => c.id))
    const other = filtered.filter((i) => !known.has(i.category_id))
    if (other.length > 0) result.push({ id: 'other', name: 'More', list: other })
    return result
  }, [categories, filtered])

  // Show the "back to top" button after scrolling down a bit
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 500)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ── Generate a composite cart key from item + modifier selections ───────────
  const makeCartKey = (itemId: string, mods: SelectedModifier[]): string => {
    if (mods.length === 0) return itemId
    const sorted = [...mods].map((m) => m.option_id).sort()
    return `${itemId}::${sorted.join(',')}`
  }

  // ── Calculate total price with modifiers ────────────────────────────────────
  const getEffectivePrice = (item: MenuItem, mods: SelectedModifier[]): number => {
    // item.price can arrive as a string ("340.00") — adding a number to it would
    // join the text ("340.0020") instead of adding, so convert both to numbers.
    const modAdjustment = mods.reduce((sum, m) => sum + (Number(m.price_adjustment) || 0), 0)
    return (Number(item.price) || 0) + modAdjustment
  }

  // ── Cart helpers ───────────────────────────────────────────────────────────
  const addToCart = (item: MenuItem, mods: SelectedModifier[] = []) => {
    const cartKey = makeCartKey(item.id, mods)
    const effectivePrice = getEffectivePrice(item, mods)
    setCart((prev) => {
      const ex = prev.find((c) => c.cart_key === cartKey)
      if (ex) return prev.map((c) => (c.cart_key === cartKey ? { ...c, quantity: c.quantity + 1 } : c))
      return [...prev, {
        cart_key: cartKey,
        id: item.id,
        name: item.name,
        price: effectivePrice,
        quantity: 1,
        is_vegetarian: item.is_vegetarian,
        modifiers: mods,
      }]
    })
  }

  const changeQty = (cartKey: string, delta: number) => {
    setCart((prev) => prev.map((c) => (c.cart_key === cartKey ? { ...c, quantity: c.quantity + delta } : c)).filter((c) => c.quantity > 0))
  }

  // Can this topping be taken off? Not if the group needs a minimum number of picks.
  const canRemoveModifier = (line: CartLine, mod: SelectedModifier): boolean => {
    const group = (itemModifierGroups[line.id] || []).find((g) => g.id === mod.group_id)
    if (!group) return true
    const picked = line.modifiers.filter((m) => m.group_id === mod.group_id).length
    return picked > (group.min_select || 0)
  }

  // Take one topping off a cart line: reprice it and merge with an identical line if there is one.
  const removeModifier = (cartKey: string, optionId: string) => {
    setCart((prev) => {
      const line = prev.find((c) => c.cart_key === cartKey)
      if (!line) return prev
      const removed = line.modifiers.find((m) => m.option_id === optionId)
      if (!removed) return prev
      const mods = line.modifiers.filter((m) => m.option_id !== optionId)
      const newKey = makeCartKey(line.id, mods)
      const updated: CartLine = {
        ...line,
        cart_key: newKey,
        modifiers: mods,
        price: line.price - (Number(removed.price_adjustment) || 0),
      }
      const rest = prev.filter((c) => c.cart_key !== cartKey)
      const twin = rest.find((c) => c.cart_key === newKey)
      if (twin) {
        return rest.map((c) => (c.cart_key === newKey ? { ...c, quantity: c.quantity + line.quantity } : c))
      }
      return prev.map((c) => (c.cart_key === cartKey ? updated : c))
    })
  }

  const cartTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0)
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0)
  const bill = calcBill(cartTotal, billing, appliedCoupon?.discount ?? 0)

  // The discount depends on the cart total, so drop it if the cart changes.
  useEffect(() => {
    setAppliedCoupon(null)
    setCouponMsg('')
  }, [cartTotal])

  const applyCoupon = async () => {
    const code = couponCode.trim()
    if (!code || cartTotal <= 0) return
    setCouponBusy(true)
    setCouponMsg('')
    try {
      const res = await publicApi.post(`/public/site/${slug}/coupon/validate`, { code, order_total: cartTotal })
      const r = res.data.data
      if (r?.valid) {
        setAppliedCoupon({ code: r.code || code.toUpperCase(), discount: Number(r.discount || 0) })
        setCouponMsg('')
      } else {
        setAppliedCoupon(null)
        setCouponMsg(r?.message || 'Invalid coupon code')
      }
    } catch (err: any) {
      setAppliedCoupon(null)
      setCouponMsg(err.response?.data?.error?.message || 'Could not check the coupon — try again')
    } finally {
      setCouponBusy(false)
    }
  }

  const removeCoupon = () => {
    setAppliedCoupon(null)
    setCouponCode('')
    setCouponMsg('')
  }

  // ── Modifier selection helpers ─────────────────────────────────────────────
  const openModifierModal = (item: MenuItem) => {
    setModifierItem(item)
    const groups = itemModifierGroups[item.id] || []
    const init: Record<string, string | string[]> = {}
    for (const g of groups) {
      init[g.id] = g.selection_type === 'single' ? '' : []
    }
    setModifierSelections(init)
    setModifierQuantity(1)
    setError('')
  }

  const toggleModifierOption = (groupId: string, optionId: string, selectionType: 'single' | 'multiple') => {
    setModifierSelections((prev) => {
      if (selectionType === 'single') {
        return { ...prev, [groupId]: prev[groupId] === optionId ? '' : optionId }
      }
      // multiple
      const current = (prev[groupId] as string[]) || []
      if (current.includes(optionId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== optionId) }
      }
      return { ...prev, [groupId]: [...current, optionId] }
    })
  }

  const closeModifierModal = () => {
    setModifierItem(null)
    setModifierSelections({})
    setModifierQuantity(1)
    setError('')
  }

  const confirmModifiers = () => {
    if (!modifierItem) return
    const groups = itemModifierGroups[modifierItem.id] || []

    // Validate selections
    for (const g of groups) {
      const sel = modifierSelections[g.id]
      if (g.selection_type === 'single') {
        const selected = (sel as string) || ''
        if (g.min_select > 0 && !selected) {
          setError(`Please select an option for "${g.name}"`)
          return
        }
      } else {
        const selected = (sel as string[]) || []
        if (selected.length < g.min_select) {
          setError(`Please select at least ${g.min_select} option(s) for "${g.name}"`)
          return
        }
        if (g.max_select > 0 && selected.length > g.max_select) {
          setError(`Please select at most ${g.max_select} option(s) for "${g.name}"`)
          return
        }
      }
    }

    // Build SelectedModifier[] from selections
    const selectedMods: SelectedModifier[] = []
    for (const g of groups) {
      const sel = modifierSelections[g.id]
      const optionIds = g.selection_type === 'single' ? (sel ? [sel as string] : []) : (sel as string[] || [])

      for (const optId of optionIds) {
        const opt = g.options.find((o) => o.id === optId)
        if (opt) {
          selectedMods.push({
            group_id: g.id,
            group_name: g.name,
            option_id: opt.id,
            option_name: opt.name,
            price_adjustment: opt.price_adjustment,
          })
        }
      }
    }

    setError('')
    for (let i = 0; i < modifierQuantity; i += 1) {
      addToCart(modifierItem, selectedMods)
    }
    closeModifierModal()
    setNotice(`${modifierQuantity} ${modifierQuantity === 1 ? 'item' : 'items'} added to your order`)
  }

  // ── Validate info step ─────────────────────────────────────────────────────
  const handleInfoNext = () => {
    setInfoError('')
    if (qrMode === 'restaurant') {
      if (!tableNumber.trim() && !tableId) {
        setInfoError('Please select or enter your table number')
        return
      }
    } else {
      if (!customerName.trim()) { setInfoError('Please enter your name'); return }
      if (!customerPhone.trim()) { setInfoError('Please enter your phone number'); return }
      if (customerPhone.replace(/\D/g, '').length < 10) { setInfoError('Please enter a valid 10-digit phone number'); return }
    }
    setStep(qrMode === 'restaurant' ? 'pin' : 'menu')
  }

  // ── Place order ────────────────────────────────────────────────────────────
  const handlePlaceOrder = async () => {
    if (cart.length === 0) return
    setPlacing(true)
    setError('')
    try {
      const body: any = {
        items: cart.map((c) => ({
          menu_item_id: c.id,
          quantity: c.quantity,
          modifiers: c.modifiers.map((m) => ({
            modifier_group_id: m.group_id,
            modifier_group_name: m.group_name,
            modifier_option_id: m.option_id,
            modifier_option_name: m.option_name,
            price_adjustment: m.price_adjustment,
          })),
        })),
      }
      if (appliedCoupon) body.coupon_code = appliedCoupon.code
      if (qrMode === 'restaurant') {
        if (tableId) body.table_id = tableId
        body.table_number = tableNumber || tables.find((t) => t.id === tableId)?.table_number
        body.table_passcode = tablePasscode
      } else {
        body.customer_name = customerName
        body.customer_phone = customerPhone
        body.payment_method = paymentMethod
      }

      const res = await publicApi.post(`/public/order/${slug}`, body)
      const data = res.data.data

      // Remember the order on this device for Ongoing Order / Order History.
      saveCustomerOrder(slug, {
        order_number: data.order_number,
        total_amount: Number(data.total_amount),
        grand_total: bill.grandTotal,
        items_count: cart.reduce((n, c) => n + c.quantity, 0),
        payment_method: data.payment_method || paymentMethod,
        table_number: qrMode === 'restaurant' ? (tableNumber || tables.find((t) => t.id === tableId)?.table_number) : undefined,
        placed_at: new Date().toISOString(),
        items: cart.map((c) => ({
          menu_item_id: c.id,
          name: c.name,
          quantity: c.quantity,
          modifiers: c.modifiers,
        })),
      })
      void tracked.refresh()

      if (data.razorpay) {
        await openRazorpayCheckout(data)
        return
      }

      setConfirmation({ ...data, payable_total: bill.grandTotal })
      setAppliedCoupon(null)
      setCouponCode('')
      setCart([])
      setCartOpen(false)
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || 'Failed to place order')
    } finally {
      setPlacing(false)
    }
  }

  const openRazorpayCheckout = async (orderData: any): Promise<void> => {
    if (!(window as any).Razorpay) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.src = 'https://checkout.razorpay.com/v1/checkout.js'
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('Failed to load Razorpay'))
        document.head.appendChild(script)
      })
    }

    const rz = orderData.razorpay

    return new Promise((resolve) => {
      const options = {
        key:         rz.key_id,
        amount:      rz.amount,
        currency:    rz.currency,
        name:        restaurantName,
        description: `Order ${orderData.order_number}`,
        order_id:    rz.razorpay_order_id,
        prefill: {
          name:    customerName  || '',
          contact: customerPhone || '',
        },
        theme: { color: '#4f46e5' },

        handler: async (response: any) => {
          try {
            await publicApi.post('/public/verify-payment', {
              order_id:            orderData.order_id,
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
            })
            setConfirmation({ ...orderData, payment_method: paymentMethod, payable_total: bill.grandTotal })
            setCart([])
            setCartOpen(false)
            resolve()
          } catch (err: any) {
            setError('Payment verified but confirmation failed. Please contact staff.')
            resolve()
          } finally {
            setPlacing(false)
          }
        },

        modal: {
          ondismiss: () => {
            setError('Payment cancelled. You can try again.')
            setPlacing(false)
            resolve()
          },
        },
      }

      const rzInstance = new (window as any).Razorpay(options)
      rzInstance.open()
    })
  }

  // ── Order confirmation ─────────────────────────────────────────────────────
  if (confirmation) {
    const isPaid = confirmation.payment_method !== 'CASH'
    return (
      <div style={accentStyle} className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
            <CheckCircleIcon className="w-12 h-12 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Order Placed!</h1>
          <p className="text-gray-500 text-sm mb-6">
            {isPaid ? 'Your payment is being processed.' : 'Your order has been sent to the kitchen.'}
          </p>

          <div className="bg-gray-50 rounded-2xl p-5 space-y-3 mb-6 text-left">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Order #</span>
              <span className="font-bold text-[color:var(--accent)] font-mono">{confirmation.order_number}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Items</span>
              <span className="font-medium">{confirmation.items_count}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Payment</span>
              <span className="font-medium">
                {PAYMENT_OPTIONS.find((p) => p.value === confirmation.payment_method)?.label || confirmation.payment_method}
              </span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 text-base border-t pt-3">
              <span>Total</span>
              <span>{formatCurrency(confirmation.payable_total ?? Number(confirmation.total_amount) * 1.18)}</span>
            </div>
          </div>

          {!isPaid && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5 text-sm text-amber-700">
              💵 Please pay <strong>{formatCurrency(confirmation.payable_total ?? Number(confirmation.total_amount) * 1.18)}</strong> at the counter when collecting your order.
            </div>
          )}

          <button
            onClick={() => { setConfirmation(null); setOrdersView('ongoing') }}
            className="w-full py-3 mb-3 border-2 border-[color:var(--accent)] text-[color:var(--accent)] font-semibold rounded-xl"
          >
            Track this order
          </button>

          <button
            onClick={() => { setConfirmation(null); setStep('info'); setCart([]) }}
            className="w-full py-3 bg-[var(--accent)] hover:brightness-95 text-white font-semibold rounded-xl transition-colors"
          >
            Order More
          </button>
        </div>
      </div>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading || (qrToken && !tableLocked && !error)) {
    return (
      <div style={accentStyle} className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-full border-2 border-gray-200 border-t-[color:var(--accent)] animate-spin mx-auto" />
          <p className="text-gray-500 text-sm">Loading menu…</p>
        </div>
      </div>
    )
  }

  if (error && items.length === 0) {
    return (
      <div style={accentStyle} className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
          <p className="text-red-600 font-medium mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2 bg-[var(--accent)] text-white rounded-xl font-medium">
            Retry
          </button>
        </div>
      </div>
    )
  }

  // ── STEP 1: Info collection ────────────────────────────────────────────────
  if (step === 'info') {
    return (
      <div style={accentStyle} className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
          {/* Header */}
          <div className="bg-[var(--accent)] px-6 py-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-3">
              <span className="text-3xl">{qrMode === 'restaurant' ? '🍽️' : '🛍️'}</span>
            </div>
            <h1 className="text-2xl font-bold text-white">{restaurantName}</h1>
            <p className="text-white/80 text-sm mt-1">
              {qrMode === 'restaurant' ? 'Dine-in ordering' : 'Food court ordering'}
            </p>
          </div>

          <div className="p-6 space-y-4">
            {qrMode === 'restaurant' ? (
              <>
                <div>
                  <label className="form-label">Select Your Table</label>
                  {tables.length > 0 ? (
                    <div className="grid grid-cols-4 gap-2 mt-1">
                      {tables.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => { setTableId(t.id); setTableNumber(t.table_number) }}
                          className={`py-2.5 text-sm font-semibold rounded-xl border-2 transition-colors ${
                            tableId === t.id
                              ? 'bg-[var(--accent)] text-white border-[color:var(--accent)]'
                              : 'bg-white text-gray-700 border-gray-200 hover:border-[color:var(--accent)]'
                          }`}
                        >
                          {t.table_number}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      type="text"
                      placeholder="e.g. T1, T2, Table 5"
                      value={tableNumber}
                      onChange={(e) => setTableNumber(e.target.value)}
                      className="form-input w-full mt-1"
                    />
                  )}
                  {tables.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-400 mb-1">Or type manually:</p>
                      <input
                        type="text"
                        placeholder="Table number"
                        value={tableNumber}
                        onChange={(e) => { setTableNumber(e.target.value); setTableId('') }}
                        className="form-input w-full text-sm"
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="form-label">Your Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    placeholder="Enter your name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="form-input w-full mt-1"
                  />
                </div>
                <div>
                  <label className="form-label">Phone Number <span className="text-red-500">*</span></label>
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="form-input w-full mt-1"
                  />
                </div>
                <div>
                  <label className="form-label">Payment Method</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {PAYMENT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setPaymentMethod(opt.value)}
                        className={`p-3 text-left rounded-xl border-2 transition-colors ${
                          paymentMethod === opt.value
                            ? 'border-[color:var(--accent)] bg-gray-50'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <span className="text-xl">{opt.icon}</span>
                        <p className="text-xs font-semibold text-gray-900 mt-1">{opt.label}</p>
                        <p className="text-xs text-gray-400">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {infoError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{infoError}</p>
            )}

            <button
              onClick={handleInfoNext}
              className="w-full py-4 bg-[var(--accent)] hover:brightness-95 text-white font-bold rounded-2xl transition-colors flex items-center justify-center gap-2"
            >
              View Menu
              <ChevronRightIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── STEP 1.5: PIN entry ─────────────────────────────────────────────────────
  if (step === 'pin') {
    return (
      <div style={accentStyle} className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
          <div className="bg-[var(--accent)] px-6 py-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-3">
              <span className="text-3xl">🔒</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Table {tableNumber}</h1>
            <p className="text-white/80 text-sm mt-1">Enter the PIN printed on your table</p>
          </div>

          <div className="p-6 space-y-4">
            <input
              type="tel"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              placeholder="••••"
              value={pinInput}
              onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyPin() }}
              className="form-input w-full text-center text-3xl font-bold tracking-[0.5em] py-4"
            />

            {pinError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{pinError}</p>
            )}

            <button
              onClick={handleVerifyPin}
              disabled={verifyingPin}
              className="w-full py-4 bg-[var(--accent)] hover:brightness-95 text-white font-bold rounded-2xl transition-colors disabled:opacity-50"
            >
              {verifyingPin ? 'Checking…' : 'Continue'}
            </button>

            {!tableLocked && (
              <button
                onClick={() => setStep('info')}
                className="w-full text-sm text-gray-400 hover:text-gray-600"
              >
                ← Choose a different table
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── STEP 2: Menu ───────────────────────────────────────────────────────────
  const showFeatured = selectedCategory === 'ALL' && !search.trim() && featuredItems.length > 0

  const vegDot = (
    <span className="w-4 h-4 rounded-sm border-2 border-emerald-600 flex items-center justify-center shrink-0" title="Vegetarian">
      <span className="w-2 h-2 rounded-full bg-emerald-600" />
    </span>
  )

  const handleAdd = (item: MenuItem) => {
    // Sold by kg / 100 g: the weight is entered by staff, so it can't go in a self-order cart
    if (item.price_unit === 'KG' || item.price_unit === '100G') {
      setNotice(`${item.name} is sold by weight — please ask the staff to add it`)
      return
    }
    // Always open the item detail sheet so customers can review the dish
    // before adding it. Items without modifiers simply show the details and
    // the quantity selector.
    openModifierModal(item)
  }

  // "Order again": put a past order back in the cart, using today's menu and prices.
  const handleReorder = (lines: SavedOrderLine[]) => {
    const menuById = new Map(items.map((i) => [i.id, i]))
    const rebuilt: CartLine[] = []
    let skipped = 0

    for (const line of lines) {
      const item = menuById.get(line.menu_item_id)
      if (!item) { skipped++; continue }   // dish is no longer on the menu

      // Keep only the options that still exist, at their current price.
      const groups = itemModifierGroups[item.id] || []
      const mods: SelectedModifier[] = []
      for (const m of line.modifiers || []) {
        const opt = groups.find((g) => g.id === m.group_id)?.options.find((o) => o.id === m.option_id)
        if (opt) {
          mods.push({
            group_id: m.group_id,
            group_name: m.group_name,
            option_id: opt.id,
            option_name: opt.name,
            price_adjustment: opt.price_adjustment,
          })
        }
      }

      rebuilt.push({
        cart_key: makeCartKey(item.id, mods),
        id: item.id,
        name: item.name,
        price: getEffectivePrice(item, mods),
        quantity: Math.max(1, Number(line.quantity) || 1),
        is_vegetarian: item.is_vegetarian,
        modifiers: mods,
      })
    }

    if (rebuilt.length > 0) {
      setCart((prev) => {
        const next = [...prev]
        for (const line of rebuilt) {
          const idx = next.findIndex((c) => c.cart_key === line.cart_key)
          if (idx >= 0) next[idx] = { ...next[idx], quantity: next[idx].quantity + line.quantity }
          else next.push(line)
        }
        return next
      })
      setCartOpen(true)
    }
    setOrdersView(null)
    setNotice(
      skipped > 0
        ? `${skipped} ${skipped === 1 ? 'dish is' : 'dishes are'} no longer on the menu and ${skipped === 1 ? 'was' : 'were'} left out.`
        : '',
    )
  }

  const renderRow = (item: MenuItem) => {
    const hasModifiers = itemModifierGroups[item.id] && itemModifierGroups[item.id].length > 0
    return (
      <div
  key={item.id}
  className="flex items-center gap-3 p-4 transition-colors hover:bg-[color:color-mix(in_srgb,var(--accent)_3%,#ffffff)]"
>
        {item.image_url && (
          <img
            src={optimizeImageUrl(item.image_url, 200)}
            alt={item.name}
            loading="lazy"
            className="w-16 h-16 rounded-2xl object-cover shrink-0 bg-gray-100 shadow-sm ring-1 ring-black/5"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.is_vegetarian && vegDot}
            <h3 className="font-semibold text-gray-900 text-sm">{item.name}</h3>
            {hasModifiers && (
              <span className="text-[10px] bg-[color:color-mix(in_srgb,var(--accent)_10%,#ffffff)] text-[color:var(--accent)] px-1.5 py-0.5 rounded-full font-medium">Customisable</span>
            )}
          </div>
          {item.description && (
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{item.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="font-bold text-[color:var(--accent)]">{formatCurrency(item.price)}{item.price_unit === 'KG' ? ' / kg' : item.price_unit === '100G' ? ' / 100 g' : ''}</span>
            <span className="text-xs text-gray-400">⏱ {item.prep_time_minutes}m</span>
          </div>
        </div>
        <button
          onClick={() => handleAdd(item)}
          aria-label={`Add ${item.name}`}
          className="shrink-0 w-11 h-11 rounded-full bg-[var(--accent)] hover:brightness-95 text-white flex items-center justify-center shadow-lg ring-4 ring-white/80 transition-transform active:scale-95"
        >
          <PlusIcon className="w-5 h-5" />
        </button>
      </div>
    )
  }

  return (
    <div
  style={accentStyle}
  className="min-h-screen bg-[color:color-mix(in_srgb,var(--accent)_5%,#f9fafb)] pb-28"
>
      <CustomerMenuDrawer
        slug={slug}
        restaurantName={restaurantName}
        orders={tracked.rows}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
        ordersView={ordersView}
        onOrdersViewChange={setOrdersView}
        onReorder={handleReorder}
      />
      {/* ── Cover ─────────────────────────────────────────────────────────── */}
      <div className={`relative overflow-hidden bg-[var(--accent)] ${ratingSummary ? 'h-64 sm:h-72' : 'h-56 sm:h-64'}`}>
        {brand.hero_image_url && (
          <img
            src={optimizeImageUrl(brand.hero_image_url, 1200)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/65" />

        <div className="relative h-full max-w-2xl mx-auto px-4 flex flex-col">
          <div className="pt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                className="p-2 bg-black/35 backdrop-blur text-white rounded-full"
              >
                <Bars3Icon className="w-5 h-5" />
              </button>
              <span className="bg-black/35 backdrop-blur text-white text-xs font-medium px-3 py-1.5 rounded-full">
                {qrMode === 'restaurant' ? `Table ${tableNumber || '—'}` : customerName}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStep('info')}
                className="bg-black/35 backdrop-blur text-white text-xs font-medium px-3 py-1.5 rounded-full"
              >
                Change
              </button>
              <button
                onClick={() => setCartOpen(true)}
                aria-label="Open your order"
                className="relative p-2 bg-white rounded-full shadow"
              >
                <ShoppingCartIcon className="w-5 h-5 text-[color:var(--accent)]" />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold">
                    {cartCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center text-center pb-7">
            <div className="w-20 h-20 rounded-full bg-white border-4 border-white shadow-lg overflow-hidden flex items-center justify-center">
              {brand.logo_url ? (
                <img
                  src={optimizeImageUrl(brand.logo_url, 200)}
                  alt={`${restaurantName} logo`}
                  className="w-full h-full object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <span className="text-3xl font-bold text-[color:var(--accent)]">
                  {restaurantName.trim().charAt(0).toUpperCase() || '🍽'}
                </span>
              )}
            </div>
            <h1 className="mt-3 text-2xl font-bold text-white drop-shadow">{restaurantName}</h1>
            {brand.tagline && <p className="text-sm text-white/85 mt-0.5 px-4">{brand.tagline}</p>}
            {ratingSummary && (
              <div className="mt-2 inline-flex items-center gap-1 bg-white/20 backdrop-blur text-white text-xs font-semibold px-2.5 py-1 rounded-full">
                <span className="text-amber-300">★</span>
                {ratingSummary.average.toFixed(1)}
                <span className="font-normal text-white/80">({ratingSummary.count})</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Search ────────────────────────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 -mt-5 relative z-10">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search dishes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3.5 text-sm bg-white rounded-2xl shadow-md border border-gray-100 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
          />
        </div>
      </div>

      {/* ── Call Waiter / Request Bill ────────────────────────────────────── */}
      {qrMode === 'restaurant' && tableId && (
        <div className="max-w-2xl mx-auto px-4 mt-3 flex gap-2">
          <button
            onClick={handleCallWaiter}
            disabled={callingWaiter || waiterCooldown}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-xl border transition-colors ${
              waiterCooldown
                ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                : 'bg-white border-gray-200 text-gray-700 hover:border-[color:var(--accent)]'
            } disabled:opacity-70`}
          >
            <BellAlertIcon className="w-4 h-4" />
            {waiterCooldown ? 'Waiter notified' : callingWaiter ? 'Calling…' : 'Call Waiter'}
          </button>
          <button
            onClick={handleRequestBill}
            disabled={requestingBill || billCooldown}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-xl border transition-colors ${
              billCooldown
                ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                : 'bg-white border-gray-200 text-gray-700 hover:border-[color:var(--accent)]'
            } disabled:opacity-70`}
          >
            <BanknotesIcon className="w-4 h-4" />
            {billCooldown ? 'Bill requested' : requestingBill ? 'Requesting…' : 'Request Bill'}
          </button>
        </div>
      )}
      {requestError && (
        <div className="max-w-2xl mx-auto px-4 mt-2">
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">{requestError}</p>
        </div>
      )}
      {notice && (
        <div className="max-w-2xl mx-auto px-4 mt-2">
          <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-1.5">{notice}</p>
        </div>
      )}

      {/* ── Live order status ─────────────────────────────────────────────── */}
      <LiveOrderBanner orders={tracked.rows} onOpen={() => setOrdersView('ongoing')} />

      {/* ── Category chips (stick to the top while scrolling) ─────────────── */}
      <div className="sticky top-0 z-20 mt-3 bg-white/90 backdrop-blur border-b border-[color:color-mix(in_srgb,var(--accent)_15%,#e5e7eb)]">
        <div className="max-w-2xl mx-auto px-4 pt-2.5 flex gap-2">
          {DIET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDiet(diet === opt.value ? 'ALL' : opt.value)}
              aria-pressed={diet === opt.value}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border transition-colors ${
                diet === opt.value
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${opt.dot}`} />
              {opt.label}
            </button>
          ))}
        </div>
        <div className="max-w-2xl mx-auto px-4 py-2 flex gap-2 overflow-x-auto scrollbar-thin">
          {[{ id: 'ALL', name: 'All' }, ...categories.map((c) => ({ id: c.id, name: c.name }))].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'bg-white border border-gray-200 text-gray-600'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Featured ──────────────────────────────────────────────────────── */}
      {showFeatured && (
        <section className="pt-5">
          <div className="max-w-2xl mx-auto px-4 flex items-center gap-2 mb-3">
            <SparklesIcon className="w-5 h-5 text-[color:var(--accent)]" />
            <h2 className="text-lg font-bold text-gray-900">Featured</h2>
          </div>
          <div className="max-w-2xl mx-auto">
            <div className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x scrollbar-thin">
              {featuredItems.map((item) => (
                <div
                  key={item.id}
                  className="snap-start shrink-0 w-64 bg-white rounded-2xl shadow-md border border-[color:color-mix(in_srgb,var(--accent)_15%,#f3f4f6)] overflow-hidden"
                >
                <div className="relative">
  <span className="absolute top-3 left-3 z-10 bg-white/95 backdrop-blur-sm text-[color:var(--accent)] text-[11px] font-bold px-2.5 py-1 rounded-full shadow-sm">
    ✨ Featured
  </span>

  <img
                      src={optimizeImageUrl(item.image_url, 600)}
                      alt={item.name}
                      loading="lazy"
                      className="w-full h-40 object-cover bg-gray-100"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                    <button
                      onClick={() => handleAdd(item)}
                      aria-label={`Add ${item.name}`}
                      className="absolute bottom-3 right-3 w-11 h-11 rounded-full bg-[var(--accent)] hover:brightness-95 text-white flex items-center justify-center shadow-lg ring-4 ring-white/80 transition-transform active:scale-95"
                    >
                      <PlusIcon className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-1.5">
                      {item.is_vegetarian && vegDot}
                      <h3 className="font-semibold text-gray-900 text-sm truncate">{item.name}</h3>
                    </div>
                    <p className="font-bold text-[color:var(--accent)] mt-1">{formatCurrency(item.price)}{item.price_unit === 'KG' ? ' / kg' : item.price_unit === '100G' ? ' / 100 g' : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Menu list ─────────────────────────────────────────────────────── */}
      <main className="max-w-2xl mx-auto px-4 pt-5">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No items found</div>
        ) : (
          sections.map((sec) => (
            <section key={sec.id} className="mb-6">
              {selectedCategory === 'ALL' && (
                <h2 className="text-lg font-bold text-gray-900 mb-2">{sec.name}</h2>
              )}
              <div className="bg-white rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_12%,#f3f4f6)] shadow-sm divide-y divide-gray-100 overflow-hidden">
                {sec.list.map(renderRow)}
              </div>
            </section>
          ))
        )}
      </main>

      {/* Back to top */}
      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          className={`fixed right-4 z-10 w-11 h-11 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center ${
            cartCount > 0 && !cartOpen ? 'bottom-24' : 'bottom-6'
          }`}
        >
          <ArrowUpIcon className="w-5 h-5 text-[color:var(--accent)]" />
        </button>
      )}

      {/* Sticky bottom bar */}
      {cartCount > 0 && !cartOpen && (
        <div className="fixed bottom-0 inset-x-0 p-4 z-10">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={() => setCartOpen(true)}
              className="w-full bg-[var(--accent)] hover:brightness-95 text-white py-4 rounded-2xl font-semibold flex items-center justify-between px-6 shadow-xl"
            >
              <span className="bg-black/20 rounded-lg px-2 py-0.5 text-sm">{cartCount}</span>
              <span>View Order</span>
              <span>{formatCurrency(cartTotal)}</span>
            </button>
          </div>
        </div>
      )}

      {/* Cart drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setCartOpen(false)} />
          <div className="relative w-full max-w-2xl bg-white rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Your Order</h2>
              <button onClick={() => setCartOpen(false)} className="p-2 rounded-full hover:bg-gray-100 text-gray-400">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {cart.map((line) => {
                return (
                  <div key={line.cart_key} className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm">{line.name}</p>
                      {line.modifiers.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {line.modifiers.map((m) => (
                            <span
                              key={m.option_id}
                              className="inline-flex items-center gap-1 rounded-full bg-gray-100 pl-2.5 pr-1.5 py-0.5 text-xs text-gray-600"
                            >
                              {m.option_name}
                              {Number(m.price_adjustment) > 0 && ` (+${formatCurrency(Number(m.price_adjustment))})`}
                              {canRemoveModifier(line, m) && (
                                <button
                                  type="button"
                                  onClick={() => removeModifier(line.cart_key, m.option_id)}
                                  className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                                  aria-label={`Remove ${m.option_name}`}
                                >
                                  <XMarkIcon className="w-3 h-3" />
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-gray-400">{formatCurrency(line.price)} each</p>
                    </div>
                    <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden">
                      <button onClick={() => changeQty(line.cart_key, -1)} className="px-3 py-2 hover:bg-gray-100 text-gray-600">
                        <MinusIcon className="w-3.5 h-3.5" />
                      </button>
                      <span className="px-2 font-bold text-sm min-w-[24px] text-center">{line.quantity}</span>
                      <button onClick={() => changeQty(line.cart_key, 1)} className="px-3 py-2 hover:bg-gray-100 text-gray-600">
                        <PlusIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 w-16 text-right">
                      {formatCurrency(line.price * line.quantity)}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="px-6 py-5 border-t border-gray-100 space-y-3">
              {/* Coupon */}
              {appliedCoupon ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-emerald-700 font-medium">Coupon {appliedCoupon.code} applied</span>
                  <button type="button" onClick={removeCoupon} className="text-xs font-medium text-red-600 px-2 py-1">Remove</button>
                </div>
              ) : (
                <div>
                  <div className="flex gap-2">
                    <input
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => { if (e.key === 'Enter') applyCoupon() }}
                      placeholder="Have a coupon code?"
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={applyCoupon}
                      disabled={couponBusy || !couponCode.trim()}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
                    >
                      {couponBusy ? '…' : 'Apply'}
                    </button>
                  </div>
                  {couponMsg && <p className="mt-1 text-xs text-red-600">{couponMsg}</p>}
                </div>
              )}

              {/* Summary */}
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-500">
                  <span>Subtotal</span><span>{formatCurrency(cartTotal)}</span>
                </div>
                {appliedCoupon && bill.coupon > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Coupon ({appliedCoupon.code})</span><span>−{formatCurrency(bill.coupon)}</span>
                  </div>
                )}
                {bill.discount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Discount ({billing.discount_percent}%)</span><span>−{formatCurrency(bill.discount)}</span>
                  </div>
                )}
                {bill.serviceCharge > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>Service charge ({billing.service_charge_percent}%)</span><span>{formatCurrency(bill.serviceCharge)}</span>
                  </div>
                )}
                {bill.otherCharges > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>Other charges ({billing.other_charges_percent}%)</span><span>{formatCurrency(bill.otherCharges)}</span>
                  </div>
                )}
                {bill.extra > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>Extra charges</span><span>{formatCurrency(bill.extra)}</span>
                  </div>
                )}
                {billing.tax_rate > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>GST ({billing.tax_rate}%{billing.tax_inclusive ? ', included in prices' : ''})</span>
                    <span>{formatCurrency(bill.taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 text-base border-t pt-2">
                  <span>Total</span><span>{formatCurrency(bill.grandTotal)}</span>
                </div>
              </div>

              {/* Payment method reminder for mall mode */}
              {qrMode === 'mall' && (
                <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-3 text-sm">
                  <span className="text-xl">{PAYMENT_OPTIONS.find((p) => p.value === paymentMethod)?.icon}</span>
                  <div>
                    <p className="font-medium text-gray-900">{PAYMENT_OPTIONS.find((p) => p.value === paymentMethod)?.label}</p>
                    <button onClick={() => { setCartOpen(false); setStep('info') }} className="text-xs text-[color:var(--accent)] hover:underline">
                      Change payment method
                    </button>
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              <button
                onClick={handlePlaceOrder}
                disabled={placing || cart.length === 0}
                className="w-full py-4 bg-[var(--accent)] hover:brightness-95 disabled:opacity-60 text-white font-bold rounded-2xl transition-colors flex items-center justify-center gap-2"
              >
                {placing ? (
                  <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                ) : (
                  <>
                    <CheckCircleIcon className="w-5 h-5" />
                    Place Order · {formatCurrency(bill.grandTotal)}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Item Detail / Modifier Modal ─────────────────────────────────────── */}
      {modifierItem && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={closeModifierModal}
          />

          <div className="relative w-full max-w-2xl bg-white rounded-t-[2rem] shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
            {/* Hero image */}
            <div className="relative shrink-0 bg-gray-100">
              {modifierItem.image_url ? (
                <img
                  src={optimizeImageUrl(modifierItem.image_url, 900)}
                  alt={modifierItem.name}
                  className="w-full h-48 sm:h-56 object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <div className="w-full h-36 flex items-center justify-center bg-[color:color-mix(in_srgb,var(--accent)_8%,#ffffff)]">
                  <SparklesIcon className="w-12 h-12 text-[var(--accent)]/40" />
                </div>
              )}

              <button
                onClick={closeModifierModal}
                aria-label="Close item details"
                className="absolute top-3 right-3 p-2.5 rounded-full bg-white/95 backdrop-blur shadow-lg text-gray-500 hover:bg-white"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Item information */}
            <div className="px-5 pt-4 pb-3 border-b border-gray-100">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {modifierItem.is_vegetarian ? (
                      <span className="w-4 h-4 rounded-sm border-2 border-emerald-600 flex items-center justify-center shrink-0" title="Vegetarian">
                        <span className="w-2 h-2 rounded-full bg-emerald-600" />
                      </span>
                    ) : (
                      <span className="w-4 h-4 rounded-sm border-2 border-red-600 flex items-center justify-center shrink-0" title="Non-vegetarian">
                        <span className="w-2 h-2 rounded-full bg-red-600" />
                      </span>
                    )}
                    <h2 className="text-xl font-extrabold text-gray-900 leading-tight">
                      {modifierItem.name}
                    </h2>
                  </div>

                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-lg font-extrabold text-[var(--accent)]">
                      {formatCurrency(modifierItem.price)}
                    </span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                      ⏱ {modifierItem.prep_time_minutes} min
                    </span>
                  </div>
                </div>
              </div>

              {modifierItem.description && (
                <p className="text-sm text-gray-500 leading-relaxed mt-3">
                  {modifierItem.description}
                </p>
              )}
            </div>

            {/* Customisations */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {(itemModifierGroups[modifierItem.id] || []).length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-base font-bold text-gray-900">Customise your order</h3>
                    <span className="text-xs text-gray-400">Choose your preferences</span>
                  </div>

                  <div className="space-y-5">
                    {(itemModifierGroups[modifierItem.id] || []).map((group) => (
                      <div key={group.id}>
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-sm font-semibold text-gray-900">{group.name}</h3>
                          {group.selection_type === 'single' ? (
                            <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                              {group.min_select > 0 ? 'Required' : 'Optional'} · Pick one
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                              {group.min_select > 0 ? `Pick ${group.min_select}${group.max_select > group.min_select ? `–${group.max_select}` : ''}` : `Up to ${group.max_select}`}
                            </span>
                          )}
                        </div>

                        <div className="space-y-2">
                          {group.options.map((opt) => {
                            const sel = modifierSelections[group.id]
                            const isSelected = group.selection_type === 'single'
                              ? (sel as string) === opt.id
                              : ((sel as string[]) || []).includes(opt.id)

                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => toggleModifierOption(group.id, opt.id, group.selection_type)}
                                className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all text-left ${
                                  isSelected
                                    ? 'border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_7%,#ffffff)] shadow-sm'
                                    : 'border-gray-200 bg-white hover:border-gray-300'
                                }`}
                              >
                                <div className={`w-5 h-5 flex items-center justify-center shrink-0 border-2 ${
                                  group.selection_type === 'single' ? 'rounded-full' : 'rounded-md'
                                } ${
                                  isSelected
                                    ? 'border-[var(--accent)] bg-[var(--accent)]'
                                    : 'border-gray-300 bg-white'
                                }`}>
                                  {isSelected && <CheckCircleIcon className="w-4 h-4 text-white" />}
                                </div>

                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-gray-900">{opt.name}</p>
                                </div>

                                {opt.price_adjustment > 0 && (
                                  <span className="text-sm font-semibold text-gray-600">
                                    +{formatCurrency(opt.price_adjustment)}
                                  </span>
                                )}
                                {opt.price_adjustment < 0 && (
                                  <span className="text-sm font-semibold text-emerald-600">
                                    -{formatCurrency(Math.abs(opt.price_adjustment))}
                                  </span>
                                )}
                                {opt.price_adjustment === 0 && (
                                  <span className="text-xs text-gray-400">Included</span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(itemModifierGroups[modifierItem.id] || []).length === 0 && (
                <div className="rounded-2xl bg-gray-50 border border-gray-100 px-4 py-3 text-sm text-gray-500">
                  This item has no customisations. Choose your quantity below.
                </div>
              )}
            </div>

            {/* Sticky footer */}
            <div className="shrink-0 px-5 pt-3 pb-5 border-t border-gray-100 bg-white space-y-3">
              {error && (
                <p className="text-xs font-medium text-red-600 bg-red-50 rounded-xl px-3 py-2.5">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-gray-400">Quantity</p>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setModifierQuantity((q) => Math.max(1, q - 1))}
                      className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 active:scale-95"
                      aria-label="Decrease quantity"
                    >
                      <MinusIcon className="w-4 h-4" />
                    </button>
                    <span className="w-8 text-center font-bold text-gray-900">{modifierQuantity}</span>
                    <button
                      type="button"
                      onClick={() => setModifierQuantity((q) => Math.min(99, q + 1))}
                      className="w-9 h-9 rounded-full bg-[var(--accent)] text-white flex items-center justify-center shadow-sm hover:brightness-95 active:scale-95"
                      aria-label="Increase quantity"
                    >
                      <PlusIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={confirmModifiers}
                  className="flex-1 max-w-sm py-3.5 px-5 bg-[var(--accent)] hover:brightness-95 text-white font-bold rounded-2xl shadow-lg transition-transform active:scale-[0.99]"
                >
                  Add {modifierQuantity} · {formatCurrency(getEffectivePrice(
                    modifierItem,
                    Object.entries(modifierSelections).flatMap(([groupId, selection]) => {
                      const group = (itemModifierGroups[modifierItem.id] || []).find((g) => g.id === groupId)
                      if (!group) return []
                      const ids = group.selection_type === 'single'
                        ? (selection ? [selection as string] : [])
                        : ((selection as string[]) || [])
                      return ids.map((id) => {
                        const opt = group.options.find((o) => o.id === id)
                        return opt ? {
                          group_id: group.id,
                          group_name: group.name,
                          option_id: opt.id,
                          option_name: opt.name,
                          price_adjustment: opt.price_adjustment,
                        } : null
                      }).filter(Boolean) as SelectedModifier[]
                    }),
                  ) * modifierQuantity)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CustomerApp
