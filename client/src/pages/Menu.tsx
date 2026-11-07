import { useEffect, useState, useMemo } from 'react'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import MenuForm from '../components/MenuForm'
import Button from '../components/Button'
import Input from '../components/Input'
import Card from '../components/Card'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import Loading from '../components/Loading'
import Modal from '../components/Modal'
import { MenuCategory, MenuItem } from '../types/menu'
import { formatCurrency } from '../lib/utils'
import { priceUnitSuffix } from '../lib/weight'
import { optimizeImageUrl } from '../lib/imageUpload'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  BookOpenIcon,
  TagIcon,
  PhotoIcon,
  ArrowsUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronDoubleUpIcon,
} from '@heroicons/react/24/outline'

/** Move the element at `idx` up/down/to-top, but only among elements of the same group. */
const Switch: React.FC<{ on: boolean; disabled?: boolean; onClick: () => void; label: string }> = ({ on, disabled, onClick, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}
  >
    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
  </button>
)

function moveWithin<T>(arr: T[], idx: number, dir: 'up' | 'down' | 'top', sameGroup: (x: T) => boolean): T[] {
  const idxs = arr.map((x, i) => (sameGroup(x) ? i : -1)).filter((i) => i >= 0)
  const pos = idxs.indexOf(idx)
  if (pos < 0) return arr
  const target = dir === 'up' ? pos - 1 : dir === 'down' ? pos + 1 : 0
  if (target < 0 || target >= idxs.length || target === pos) return arr
  const group = idxs.map((i) => arr[i])
  const [moved] = group.splice(pos, 1)
  group.splice(target, 0, moved)
  const out = [...arr]
  idxs.forEach((i, k) => { out[i] = group[k] })
  return out
}

/** One row in reorder mode: position number, label, and big tap-friendly arrows. */
const ReorderRow: React.FC<{
  position: number
  isFirst: boolean
  isLast: boolean
  image?: string | null
  title: string
  subtitle?: string
  onMove: (dir: 'up' | 'down' | 'top') => void
}> = ({ position, isFirst, isLast, image, title, subtitle, onMove }) => {
  const btn = 'w-10 h-10 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 active:bg-indigo-50 disabled:opacity-30'
  return (
    <div className="flex items-center gap-3 p-2 bg-white border border-gray-200 rounded-xl">
      <span className="w-6 text-center text-xs font-semibold text-gray-400">{position}</span>
      {image !== undefined && (
        image
          ? <img src={optimizeImageUrl(image, 120)} alt="" className="w-11 h-11 rounded-lg object-cover bg-gray-100" />
          : <div className="w-11 h-11 rounded-lg bg-gray-100" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
      <button className={btn} disabled={isFirst} onClick={() => onMove('top')} aria-label="Move to top">
        <ChevronDoubleUpIcon className="w-4 h-4" />
      </button>
      <button className={btn} disabled={isFirst} onClick={() => onMove('up')} aria-label="Move up">
        <ChevronUpIcon className="w-5 h-5" />
      </button>
      <button className={btn} disabled={isLast} onClick={() => onMove('down')} aria-label="Move down">
        <ChevronDownIcon className="w-5 h-5" />
      </button>
    </div>
  )
}

const Menu: React.FC = () => {
  const [items, setItems] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<MenuItem | undefined>()
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<string>('ALL')
  const [availFilter, setAvailFilter] = useState<'all' | 'available' | 'unavailable'>('all')

  // Category management
  const [catFormOpen, setCatFormOpen] = useState(false)
  const [editingCat, setEditingCat] = useState<MenuCategory | undefined>()
  const [catName, setCatName] = useState('')
  const [catDesc, setCatDesc] = useState('')
  const [catSaving, setCatSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // Reorder mode
  const [reorderMode, setReorderMode] = useState(false)
  const [snapshot, setSnapshot] = useState<{ cats: MenuCategory[]; items: MenuItem[] } | null>(null)
  const [catsDirty, setCatsDirty] = useState(false)
  const [dirtyItemCats, setDirtyItemCats] = useState<Set<string>>(new Set())
  const [reorderCat, setReorderCat] = useState<string>('')
  const [savingOrder, setSavingOrder] = useState(false)

  const fetchAll = async () => {
    try {
      const [itemsRes, catsRes] = await Promise.all([
        api.get('/menus/items'),
        api.get('/menus/categories'),
      ])
      setItems(itemsRes.data.data || [])
      setCategories(catsRes.data.data || [])
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const matchCat = catFilter === 'ALL' || item.category_id === catFilter
      const matchAvail =
        availFilter === 'all' ||
        (availFilter === 'available' && item.is_active) ||
        (availFilter === 'unavailable' && !item.is_active)
      const matchSearch =
        !search || item.name.toLowerCase().includes(search.toLowerCase())
      return matchCat && matchAvail && matchSearch
    })
  }, [items, catFilter, availFilter, search])

  // Sections follow the category order (the same order customers see).
  const grouped = useMemo(() => {
    const map: Record<string, MenuItem[]> = {}
    categories.forEach((c) => {
      const list = filtered.filter((i) => i.category_id === c.id)
      if (list.length) map[c.name] = list
    })
    const rest = filtered.filter((i) => !categories.some((c) => c.id === i.category_id))
    if (rest.length) map['Uncategorized'] = rest
    return map
  }, [filtered, categories])

  // ── Reorder ──────────────────────────────────────────────
  const startReorder = () => {
    setSnapshot({ cats: categories, items })
    setCatsDirty(false)
    setDirtyItemCats(new Set())
    setReorderCat(categories[0]?.id || '')
    setSearch('')
    setCatFilter('ALL')
    setAvailFilter('all')
    setReorderMode(true)
  }

  const cancelReorder = () => {
    if (snapshot) { setCategories(snapshot.cats); setItems(snapshot.items) }
    setReorderMode(false)
  }

  const moveCategory = (id: string, dir: 'up' | 'down' | 'top') => {
    setCategories((prev) => moveWithin(prev, prev.findIndex((c) => c.id === id), dir, () => true))
    setCatsDirty(true)
  }

  const moveItem = (id: string, dir: 'up' | 'down' | 'top') => {
    const item = items.find((i) => i.id === id)
    if (!item) return
    setItems((prev) => moveWithin(prev, prev.findIndex((i) => i.id === id), dir, (x) => x.category_id === item.category_id))
    setDirtyItemCats((prev) => new Set(prev).add(item.category_id))
  }

  const saveOrder = async () => {
    setSavingOrder(true)
    try {
      if (catsDirty) {
        await api.put('/menus/reorder', { type: 'categories', ids: categories.map((c) => c.id) })
      }
      for (const catId of dirtyItemCats) {
        const ids = items.filter((i) => i.category_id === catId).map((i) => i.id)
        if (ids.length) await api.put('/menus/reorder', { type: 'items', ids })
      }
      toast.success('Menu order saved')
      setReorderMode(false)
      await fetchAll()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSavingOrder(false)
    }
  }

  const hasReorderChanges = catsDirty || dirtyItemCats.size > 0
  const reorderItems = items.filter((i) => i.category_id === reorderCat)

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this menu item?')) return
    try {
      await api.delete(`/menus/items/${id}`)
      setItems((p) => p.filter((i) => i.id !== id))
      toast.success('Item deleted')
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  const handleToggleAvail = async (item: MenuItem) => {
    if (togglingId) return
    setTogglingId(item.id)
    try {
      const res = await api.put(`/menus/items/${item.id}`, { is_active: !item.is_active })
      setItems((p) => p.map((i) => (i.id === item.id ? res.data.data : i)))
      toast.success(item.is_active ? 'Item marked unavailable' : 'Item marked available')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setTogglingId(null)
    }
  }

  // Ready-made items: flip "out of batch" when today's batch is finished, so
  // orders go to the kitchen (to be cooked) instead of straight to the waiter.
  const handleToggleReadyStock = async (item: MenuItem) => {
    if (togglingId) return
    setTogglingId(item.id)
    try {
      const inStock = item.ready_in_stock !== false
      const res = await api.put(`/menus/items/${item.id}/ready-stock`, { ready_in_stock: !inStock })
      setItems((p) => p.map((i) => (i.id === item.id ? res.data.data : i)))
      toast.success(inStock ? 'Out of batch — orders go to the kitchen' : 'Ready-made again — orders go straight to the waiter')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setTogglingId(null)
    }
  }

  const [orderingEnabled, setOrderingEnabled] = useState<boolean | null>(null)
  const [orderingBusy, setOrderingBusy] = useState(false)

  useEffect(() => {
    api.get('/restaurants/me')
      .then((res) => setOrderingEnabled(res.data.data.ordering_enabled !== false))
      .catch(() => setOrderingEnabled(null))
  }, [])

  const handleToggleOrdering = async () => {
    if (orderingEnabled === null || orderingBusy) return
    const next = !orderingEnabled
    if (!next && !window.confirm('Turn customer ordering OFF? Customers will still see the menu but cannot place orders.')) return
    setOrderingBusy(true)
    try {
      await api.put('/restaurants/me', { ordering_enabled: next })
      setOrderingEnabled(next)
      toast.success(next ? 'Customer ordering is ON' : 'Customer ordering is OFF — menu is view-only')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setOrderingBusy(false)
    }
  }

  const handleToggleCat = async (cat: MenuCategory) => {
    if (togglingId) return
    setTogglingId(cat.id)
    try {
      const res = await api.put(`/menus/categories/${cat.id}`, { is_active: !cat.is_active })
      setCategories((p) => p.map((c) => (c.id === cat.id ? res.data.data : c)))
      toast.success(cat.is_active ? `${cat.name} turned off` : `${cat.name} turned on`)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setTogglingId(null)
    }
  }

  const handleSaveCat = async (e: React.FormEvent) => {
    e.preventDefault()
    setCatSaving(true)
    try {
      if (editingCat) {
        const res = await api.put(`/menus/categories/${editingCat.id}`, { name: catName, description: catDesc })
        setCategories((p) => p.map((c) => (c.id === editingCat.id ? res.data.data : c)))
        toast.success('Category updated')
      } else {
        const res = await api.post('/menus/categories', { name: catName, description: catDesc, display_order: categories.length + 1 })
        setCategories((p) => [...p, res.data.data])
        toast.success('Category created')
      }
      setCatFormOpen(false)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setCatSaving(false)
    }
  }

  const handleDeleteCat = async (id: string) => {
    if (!confirm('Delete this category? Items in it will be uncategorized.')) return
    try {
      await api.delete(`/menus/categories/${id}`)
      setCategories((p) => p.filter((c) => c.id !== id))
      toast.success('Category deleted')
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  if (loading) return <Loading text="Loading menu…" />

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Menu</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {items.length} items · {categories.length} categories
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="primary"
            leftIcon={<ArrowsUpDownIcon className="w-4 h-4" />}
            onClick={startReorder}
            disabled={reorderMode || items.length === 0}
          >
            Rearrange Menu
          </Button>
          <Button
            variant="outline"
            leftIcon={<TagIcon className="w-4 h-4" />}
            onClick={() => { setEditingCat(undefined); setCatName(''); setCatDesc(''); setCatFormOpen(true) }}
          >
            Add Category
          </Button>
          <Button
            variant="primary"
            leftIcon={<PlusIcon className="w-4 h-4" />}
            onClick={() => { setEditing(undefined); setFormOpen(true) }}
          >
            Add Item
          </Button>
        </div>
      </div>

      {reorderMode ? (
        <div className="space-y-5 pb-24">
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3 text-sm text-indigo-800">
            Use the arrows to move things up or down. The double arrow sends it to the top.
            Customers see the same order. Tap <b>Save order</b> when you are done.
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Categories</h2>
            <div className="space-y-2">
              {categories.map((c, i) => (
                <ReorderRow
                  key={c.id}
                  position={i + 1}
                  isFirst={i === 0}
                  isLast={i === categories.length - 1}
                  title={c.name}
                  subtitle={`${items.filter((x) => x.category_id === c.id).length} items`}
                  onMove={(dir) => moveCategory(c.id, dir)}
                />
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Items in</h2>
            <select
              value={reorderCat}
              onChange={(e) => setReorderCat(e.target.value)}
              className="form-select w-full mb-3"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="space-y-2">
              {reorderItems.length === 0 && (
                <p className="text-sm text-gray-400 py-4 text-center">No items in this category.</p>
              )}
              {reorderItems.map((it, i) => (
                <ReorderRow
                  key={it.id}
                  position={i + 1}
                  isFirst={i === 0}
                  isLast={i === reorderItems.length - 1}
                  image={it.image_url || null}
                  title={it.name}
                  subtitle={formatCurrency(it.price)}
                  onMove={(dir) => moveItem(it.id, dir)}
                />
              ))}
            </div>
          </div>

          <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 p-3 flex gap-3 lg:pl-72">
            <Button variant="outline" fullWidth onClick={cancelReorder} disabled={savingOrder}>
              Cancel
            </Button>
            <Button variant="primary" fullWidth onClick={saveOrder} isLoading={savingOrder} disabled={!hasReorderChanges}>
              Save order
            </Button>
          </div>
        </div>
      ) : (
        <>
      {/* Filters */}
      <Card padding="sm">
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<MagnifyingGlassIcon className="w-4 h-4" />}
            fullWidth
          />
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="form-select min-w-[150px]"
          >
            <option value="ALL">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            {(['all', 'available', 'unavailable'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setAvailFilter(f)}
                className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors capitalize ${
                  availFilter === f
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Customer ordering on/off */}
      {orderingEnabled !== null && (
        <Card padding="sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 text-sm">Customer ordering</p>
              <p className="text-xs text-gray-500">
                {orderingEnabled
                  ? 'ON: customers can order from the QR menu and website.'
                  : 'OFF: customers can only view the menu. Staff can still take orders.'}
              </p>
            </div>
            <Switch on={orderingEnabled} disabled={orderingBusy} onClick={handleToggleOrdering} label="Customer ordering on/off" />
          </div>
        </Card>
      )}

      {/* Categories quick view */}
      {categories.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className={`flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm ${cat.is_active ? '' : 'opacity-60'}`}
            >
              <Switch on={cat.is_active} disabled={togglingId === cat.id} onClick={() => handleToggleCat(cat)} label={`${cat.name} on/off`} />
              <span className="font-medium text-gray-700">{cat.name}</span>
              <span className="text-gray-400 text-xs">
                {items.filter((i) => i.category_id === cat.id).length}
              </span>
              <button
                onClick={() => { setEditingCat(cat); setCatName(cat.name); setCatDesc(cat.description || ''); setCatFormOpen(true) }}
                className="text-gray-400 hover:text-indigo-600 transition-colors"
              >
                <PencilIcon className="w-3 h-3" />
              </button>
              <button
                onClick={() => handleDeleteCat(cat.id)}
                className="text-gray-400 hover:text-red-500 transition-colors"
              >
                <TrashIcon className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Items by category */}
      {Object.keys(grouped).length === 0 ? (
        <Card>
          <EmptyState
            icon={<BookOpenIcon className="w-7 h-7" />}
            title="No menu items"
            description="Add your first menu item to get started."
            action={{ label: 'Add Item', onClick: () => setFormOpen(true) }}
          />
        </Card>
      ) : (
        Object.entries(grouped).map(([catName, catItems]) => (
          <div key={catName}>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              {catName} <span className="text-gray-400 font-normal normal-case">({catItems.length})</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {catItems.map((item) => (
                <Card key={item.id} padding="sm" className={`group relative ${item.is_active ? '' : 'opacity-60'}`}>
                  {item.image_url ? (
                    <div className="relative mb-3">
                      <img
                        src={optimizeImageUrl(item.image_url, 500)}
                        alt={item.name}
                        loading="lazy"
                        className="w-full h-32 object-cover rounded-lg bg-gray-100"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                      {item.is_featured && (
                        <span className="absolute top-2 left-2 text-xs font-semibold bg-amber-400 text-amber-950 px-2 py-0.5 rounded-full shadow">
                          ⭐ Featured
                        </span>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setEditing(item); setFormOpen(true) }}
                      className="w-full h-16 mb-3 flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-gray-200 text-xs text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
                    >
                      <PhotoIcon className="w-4 h-4" />
                      Add photo
                    </button>
                  )}
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0 pr-2">
                      <h3 className="font-semibold text-gray-900 text-sm leading-tight">{item.name}</h3>
                      {item.description && (
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{item.description}</p>
                      )}
                    </div>
                    <span className="text-base font-bold text-indigo-600 shrink-0">
                      {formatCurrency(item.price)}
                      {priceUnitSuffix(item.price_unit) && (
                        <span className="text-xs font-medium text-gray-500"> {priceUnitSuffix(item.price_unit)}</span>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-3 mb-6">
                    {item.is_vegetarian && (
                      <span className="text-xs text-emerald-600 font-medium">🌱 Veg</span>
                    )}
                    <span className="text-xs text-gray-400">⏱ {item.prep_time_minutes}m</span>
                    {item.skip_kitchen && (
                      <button
                        type="button"
                        disabled={togglingId === item.id}
                        onClick={() => handleToggleReadyStock(item)}
                        title="Tap when today's batch is finished (or restocked)"
                        className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                          item.ready_in_stock === false
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        }`}
                      >
                        {item.ready_in_stock === false ? '🍳 Out of batch → kitchen' : '⚡ Ready-made'}
                      </button>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <Badge variant={item.is_active ? 'success' : 'default'} className="text-xs">
                        {item.is_active ? 'On' : 'Off'}
                      </Badge>
                      <Switch on={item.is_active} disabled={togglingId === item.id} onClick={() => handleToggleAvail(item)} label={`${item.name} on/off`} />
                    </div>
                  </div>

                  {/* Hover actions */}
                  <div className="absolute inset-x-0 bottom-0 flex opacity-0 group-hover:opacity-100 transition-opacity bg-white border-t border-gray-100 rounded-b-xl overflow-hidden">
                    <button
                      onClick={() => { setEditing(item); setFormOpen(true) }}
                      className="flex-1 py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
                    >
                      Edit
                    </button>
                    <div className="w-px bg-gray-100" />
                    <button
                      onClick={() => handleToggleAvail(item)}
                      disabled={togglingId === item.id}
                      className="flex-1 py-2 text-xs font-medium text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {item.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <div className="w-px bg-gray-100" />
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="flex-1 py-2 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

        </>
      )}

      {/* Item form */}
      {formOpen && (
        <MenuForm
          menuItem={editing}
          onClose={() => setFormOpen(false)}
          onSave={(saved) => {
            if (editing) {
              setItems((p) => p.map((i) => (i.id === saved.id ? saved : i)))
              toast.success('Item updated')
            } else {
              setItems((p) => [saved, ...p])
              toast.success('Item created')
            }
            setFormOpen(false)
          }}
        />
      )}

      {/* Category form */}
      <Modal
        isOpen={catFormOpen}
        onClose={() => setCatFormOpen(false)}
        title={editingCat ? 'Edit Category' : 'Add Category'}
        size="sm"
        footer={
          <div className="flex gap-3">
            <Button type="submit" form="cat-form" variant="primary" fullWidth isLoading={catSaving}>
              {editingCat ? 'Save' : 'Create'}
            </Button>
            <Button variant="outline" fullWidth onClick={() => setCatFormOpen(false)}>
              Cancel
            </Button>
          </div>
        }
      >
        <form id="cat-form" onSubmit={handleSaveCat} className="space-y-4">
          <Input
            label="Category Name"
            placeholder="e.g. Starters, Mains, Beverages"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            required
            fullWidth
          />
          <Input
            label="Description (optional)"
            placeholder="Brief description"
            value={catDesc}
            onChange={(e) => setCatDesc(e.target.value)}
            fullWidth
          />
        </form>
      </Modal>
    </div>
  )
}

export default Menu
