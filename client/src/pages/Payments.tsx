import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import PaymentForm from '../components/PaymentForm'
import Button from '../components/Button'
import Input from '../components/Input'
import Card from '../components/Card'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import Loading from '../components/Loading'
import Modal from '../components/Modal'
import Pagination from '../components/Pagination'
import { Payment } from '../types/payment'
import { formatCurrency, formatDate } from '../lib/utils'
import {
  PlusIcon,
  MagnifyingGlassIcon,
  CurrencyDollarIcon,
  TrashIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline'

const STATUS_BADGE: Record<string, { variant: any; label: string }> = {
  PENDING:  { variant: 'warning', label: 'Pending' },
  PAID:     { variant: 'success', label: 'Paid' },
  REFUNDED: { variant: 'purple',  label: 'Refunded' },
}

const METHOD_ICON: Record<string, string> = {
  CASH: '💵', CARD: '💳', UPI: '📱', ONLINE: '🌐',
}

const METHODS = ['CASH', 'CARD', 'UPI', 'ONLINE'] as const
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', CARD: 'Card', UPI: 'UPI', ONLINE: 'Online' }

const ITEMS_PER_PAGE = 20

const Payments: React.FC = () => {
  const navigate = useNavigate()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [currentPage, setCurrentPage] = useState(1)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Payment | null>(null)
  const [editMethod, setEditMethod] = useState<string>('CASH')
  const [editRef, setEditRef] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const fetchPayments = async () => {
    try {
      const res = await api.get('/payments', { params: { limit: 500 } })
         setPayments(res.data.data?.items || [])
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPayments() }, [])

  const filtered = useMemo(() => {
    return payments.filter((p) => {
      const matchStatus = statusFilter === 'ALL' || p.status === statusFilter
      const matchSearch =
        !search ||
        p.id.toLowerCase().includes(search.toLowerCase()) ||
        p.order_id.toLowerCase().includes(search.toLowerCase()) ||
        (p.reference_number || '').toLowerCase().includes(search.toLowerCase())
      return matchStatus && matchSearch
    })
  }, [payments, search, statusFilter])

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE
    return filtered.slice(start, start + ITEMS_PER_PAGE)
  }, [filtered, currentPage])

  useEffect(() => { setCurrentPage(1) }, [search, statusFilter])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this payment record?')) return
    try {
      await api.delete(`/payments/${id}`)
      setPayments((p) => p.filter((x) => x.id !== id))
      toast.success('Payment deleted')
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  const handleMarkPaid = async (id: string) => {
    if (markingId) return
    setMarkingId(id)
    try {
      await api.patch(`/payments/${id}`, { status: 'PAID' })
      setPayments((p) => p.map((x) => x.id === id ? { ...x, status: 'PAID' as any } : x))
      toast.success('Payment marked as paid')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setMarkingId(null)
    }
  }

  const openEdit = (payment: Payment) => {
    setEditing(payment)
    setEditMethod(payment.method)
    setEditRef(payment.reference_number || '')
  }

  const handleSaveEdit = async () => {
    if (!editing || savingEdit) return
    const newRef = editRef.trim()
    const unchanged = editMethod === editing.method && newRef === (editing.reference_number || '')
    if (unchanged) { setEditing(null); return }
    setSavingEdit(true)
    try {
      await api.patch(`/payments/${editing.id}`, { method: editMethod, reference_number: newRef })
      // The update response has no order/table details, so merge only what changed
      setPayments((list) =>
        list.map((x) =>
          x.id === editing.id ? { ...x, method: editMethod as any, reference_number: newRef || null } : x,
        ),
      )
      toast.success(`Payment mode changed to ${METHOD_LABEL[editMethod] || editMethod}`)
      setEditing(null)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSavingEdit(false)
    }
  }

  // Summary stats
  const totalPaid = payments.filter((p) => p.status === 'PAID').reduce((s, p) => s + Number(p.amount), 0)
  const totalPending = payments.filter((p) => p.status === 'PENDING').reduce((s, p) => s + Number(p.amount), 0)
  const totalRefunded = payments.filter((p) => p.status === 'REFUNDED').reduce((s, p) => s + Number(p.amount), 0)

  if (loading) return <Loading text="Loading payments…" />

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
          <p className="text-sm text-slate-500 mt-0.5">{payments.length} total transactions</p>
        </div>
        <Button
          variant="primary"
          leftIcon={<PlusIcon className="w-4 h-4" />}
          onClick={() => setFormOpen(true)}
        >
          Record Payment
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Collected', value: formatCurrency(totalPaid),     color: 'text-emerald-700', bg: 'bg-emerald-50 border border-emerald-200', icon: 'text-emerald-500' },
          { label: 'Pending',         value: formatCurrency(totalPending),   color: 'text-amber-700',   bg: 'bg-amber-50 border border-amber-200',     icon: 'text-amber-500' },
          { label: 'Refunded',        value: formatCurrency(totalRefunded),  color: 'text-purple-700',  bg: 'bg-purple-50 border border-purple-200',   icon: 'text-purple-500' },
        ].map((s) => (
          <div key={s.label} className={`flex items-center gap-4 rounded-2xl p-5 shadow-card ${s.bg}`}>
            <CurrencyDollarIcon className={`w-8 h-8 shrink-0 ${s.icon}`} />
            <div>
              <p className="text-sm text-slate-600">{s.label}</p>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <Card padding="sm">
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Search by ID or reference…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<MagnifyingGlassIcon className="w-4 h-4" />}
            fullWidth
          />
          <div className="flex gap-2">
            {(['ALL', 'PAID', 'PENDING', 'REFUNDED'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  statusFilter === s
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {s === 'ALL' ? 'All' : s}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Table */}
      {paginated.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CurrencyDollarIcon className="w-7 h-7" />}
            title="No payments found"
            description="Record a payment to get started."
            action={{ label: 'Record Payment', onClick: () => setFormOpen(true) }}
          />
        </Card>
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Payment ID</th>
                  <th>Order</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Reference</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((payment) => {
                  const badge = STATUS_BADGE[payment.status] || STATUS_BADGE.PENDING
                  return (
                    <tr key={payment.id}>
                      <td className="font-mono text-xs text-slate-400">
                        {payment.id.slice(0, 8)}…
                      </td>
                      <td>
                        {payment.order_number ? (
                          <button
                            onClick={() => navigate(`/orders/${payment.order_id}`)}
                            className="flex items-center gap-1.5 group"
                          >
                            <span className="text-sm font-semibold text-brand-600 group-hover:text-brand-800 transition-colors">
                              {payment.order_number}
                            </span>
                            <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5 text-brand-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        ) : (
                          <span className="font-mono text-xs text-slate-400">
                            {payment.order_id.slice(0, 8)}…
                          </span>
                        )}
                        {payment.table_number && (
                          <p className="text-xs text-slate-400 mt-0.5">Table {payment.table_number}</p>
                        )}
                        {payment.order_type && !payment.table_number && (
                          <p className="text-xs text-slate-400 mt-0.5">{payment.order_type.replace('_', ' ')}</p>
                        )}
                      </td>
                      <td className="font-semibold text-gray-900">
                        {formatCurrency(Number(payment.amount))}
                      </td>
                      <td>
                        <span className="flex items-center gap-1.5 text-sm">
                          <span>{METHOD_ICON[payment.method] || '💰'}</span>
                          {payment.method}
                        </span>
                      </td>
                      <td>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                      <td className="text-gray-400 text-xs font-mono">
                        {payment.reference_number || '—'}
                      </td>
                      <td className="text-gray-400 text-xs whitespace-nowrap">
                        {formatDate(payment.created_at)}
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          {payment.status === 'PENDING' && (
                            <button
                              onClick={() => handleMarkPaid(payment.id)}
                              disabled={markingId === payment.id}
                              title="Mark as paid"
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <CheckCircleIcon className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(payment)}
                            title="Edit payment mode"
                            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                          >
                            <PencilSquareIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(payment.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center py-4 border-t border-gray-100">
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
            </div>
          )}
        </Card>
      )}

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title="Edit payment mode"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={savingEdit}>Cancel</Button>
            <Button variant="primary" onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? 'Saving…' : 'Save'}
            </Button>
          </div>
        }
      >
        {editing && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              {editing.order_number ? `Order ${editing.order_number}` : 'Payment'} ·{' '}
              <span className="font-semibold text-slate-800">{formatCurrency(Number(editing.amount))}</span>
            </p>

            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">How was it actually paid?</p>
              <div className="grid grid-cols-2 gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setEditMethod(m)}
                    className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${
                      editMethod === m
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span>{METHOD_ICON[m]}</span>
                    {METHOD_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>

            <Input
              label="Reference number (optional)"
              placeholder="UPI / card transaction ID"
              value={editRef}
              onChange={(e) => setEditRef(e.target.value)}
              fullWidth
            />

            {editing.method === 'ONLINE' && (
              <p className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
                This was paid through the online gateway. Changing it only changes how it appears in your
                records — it does not move any money.
              </p>
            )}
          </div>
        )}
      </Modal>

      {formOpen && (
        <PaymentForm
          orderId=""
          onClose={() => setFormOpen(false)}
          onPaymentSuccess={() => {
            setFormOpen(false)
            toast.success('Payment recorded')
            fetchPayments()
          }}
        />
      )}
    </div>
  )
}

export default Payments
