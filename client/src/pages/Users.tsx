import { useEffect, useState, useMemo } from 'react'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import Button from '../components/Button'
import Input from '../components/Input'
import Modal from '../components/Modal'
import Card from '../components/Card'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import Loading from '../components/Loading'
import { User, UserRole } from '../types/user'
import { getInitials } from '../lib/utils'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'

const ROLE_BADGE: Record<UserRole, { variant: any; label: string }> = {
  ADMIN:     { variant: 'error',   label: 'Admin' },
  WAITER:    { variant: 'info',    label: 'Waiter' },
  KITCHEN:   { variant: 'warning', label: 'Kitchen' },
  RECEPTION: { variant: 'success', label: 'Reception' },
}

interface FormData {
  email: string
  password: string
  name: string
  role: UserRole
  is_active: boolean
}

const defaultForm: FormData = {
  email: '', password: '', name: '', role: 'WAITER', is_active: true,
}

const Users: React.FC = () => {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [form, setForm] = useState<FormData>(defaultForm)
  const [saving, setSaving] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [pwdUserId, setPwdUserId] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [savingPwd, setSavingPwd] = useState(false)
  const [allTables, setAllTables] = useState<{ id: string; table_number: string }[]>([])
  const [assignedIds, setAssignedIds] = useState<string[]>([])
  const [pickupAssigned, setPickupAssigned] = useState(false)
  const [search, setSearch] = useState('')
  // Admin switch: can waiters collect payment?
  const [waiterCanPay, setWaiterCanPay] = useState<boolean | null>(null)
  const [waiterPayBusy, setWaiterPayBusy] = useState(false)
  const [roleFilter, setRoleFilter] = useState<UserRole | 'ALL'>('ALL')

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users')
      setUsers(res.data.data || [])
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchUsers() }, [])

  useEffect(() => {
    api.get('/restaurants/me')
      .then((res) => setWaiterCanPay(res.data.data?.waiter_can_collect_payment !== false))
      .catch(() => {})
  }, [])

  const handleToggleWaiterPay = async () => {
    if (waiterCanPay === null || waiterPayBusy) return
    const next = !waiterCanPay
    setWaiterPayBusy(true)
    try {
      await api.put('/restaurants/me', { waiter_can_collect_payment: next })
      setWaiterCanPay(next)
      toast.success(next ? 'Waiters can collect payment' : 'Waiters can no longer collect payment')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setWaiterPayBusy(false)
    }
  }

  const filtered = useMemo(() => {
    return users.filter((u) => {
      const matchRole = roleFilter === 'ALL' || u.role === roleFilter
      const matchSearch =
        !search ||
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
      return matchRole && matchSearch
    })
  }, [users, search, roleFilter])

  const openCreate = () => {
    setEditing(null)
    setAssignedIds([])
    setPickupAssigned(false)
    loadTablesForForm()
    setForm(defaultForm)
    setFormOpen(true)
  }

  const loadTablesForForm = async (userId?: string) => {
    try {
      const res = await api.get('/tables', { params: { limit: 500 } })
      setAllTables(res.data.data || [])
      if (userId) {
        const a = await api.get(`/users/${userId}/tables`)
        setAssignedIds(a.data.data.table_ids || [])
        setPickupAssigned(Boolean(a.data.data.pickup))
      }
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  const toggleAssigned = (id: string) =>
    setAssignedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const openEdit = (user: User) => {
    setAssignedIds([])
    setPickupAssigned(false)
    loadTablesForForm(user.id)
    setEditing(user)
    setForm({
      email: user.email,
      password: '',
      name: user.name,
      role: user.role,
      is_active: (user as any).is_active ?? true,
    })
    setFormOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (!form.email.trim()) { toast.error('Email is required'); return }
    if (!editing && !form.password.trim()) { toast.error('Password is required'); return }
    setSaving(true)
    try {
      if (editing) {
        const res = await api.put(`/users/${editing.id}`, {
          name: form.name,
          email: form.email,
          role: form.role,
          is_active: form.is_active,
        })
        if (form.role === 'WAITER') await api.put(`/users/${editing.id}/tables`, { table_ids: assignedIds, pickup: pickupAssigned })
        setUsers((p) => p.map((u) => (u.id === editing.id ? res.data.data : u)))
        toast.success('User updated')
      } else {
        const res = await api.post('/users', form)
        if (form.role === 'WAITER' && (assignedIds.length > 0 || pickupAssigned)) await api.put(`/users/${res.data.data.id}/tables`, { table_ids: assignedIds, pickup: pickupAssigned })
        setUsers((p) => [res.data.data, ...p])
        toast.success('User created')
      }
      setFormOpen(false)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this user permanently?')) return
    try {
      await api.delete(`/users/${id}`)
      setUsers((p) => p.filter((u) => u.id !== id))
      toast.success('User deleted')
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  const handlePasswordReset = async () => {
    if (newPwd.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setSavingPwd(true)
    try {
      await api.patch(`/users/${pwdUserId}/password`, { newPassword: newPwd })
      toast.success('Password updated')
      setPwdOpen(false)
      setNewPwd('')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSavingPwd(false)
    }
  }

  if (loading) return <Loading text="Loading users…" />

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500 mt-0.5">{users.length} team member{users.length !== 1 ? 's' : ''}</p>
        </div>
        <Button
          variant="primary"
          leftIcon={<PlusIcon className="w-4 h-4" />}
          onClick={openCreate}
        >
          Add User
        </Button>
      </div>

      {/* Waiter payment permission */}
      {waiterCanPay !== null && (
        <Card padding="sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">Waiters can collect payment</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {waiterCanPay
                  ? 'On: waiters can take payment at the table.'
                  : 'Off: waiters can still take orders and print the bill, but only reception and admin can collect payment.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={waiterCanPay}
              aria-label="Waiters can collect payment"
              disabled={waiterPayBusy}
              onClick={handleToggleWaiterPay}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${waiterCanPay ? 'bg-emerald-500' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${waiterCanPay ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </Card>
      )}

      {/* Filters */}
      <Card padding="sm">
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<MagnifyingGlassIcon className="w-4 h-4" />}
            fullWidth
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="form-select min-w-[130px]"
          >
            <option value="ALL">All Roles</option>
            <option value="ADMIN">Admin</option>
            <option value="WAITER">Waiter</option>
            <option value="KITCHEN">Kitchen</option>
            <option value="RECEPTION">Reception</option>
          </select>
        </div>
      </Card>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UsersIcon className="w-7 h-7" />}
            title="No users found"
            description="Add team members to get started."
            action={{ label: 'Add User', onClick: openCreate }}
          />
        </Card>
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => {
                  const badge = ROLE_BADGE[user.role]
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                            <span className="text-indigo-700 font-semibold text-xs">
                              {getInitials(user.name)}
                            </span>
                          </div>
                          <span className="font-medium text-gray-900">{user.name}</span>
                        </div>
                      </td>
                      <td className="text-gray-500">{user.email}</td>
                      <td>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                      <td>
                        <Badge variant={(user as any).is_active !== false ? 'success' : 'default'}>
                          {(user as any).is_active !== false ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(user)}
                            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <PencilIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setPwdUserId(user.id); setNewPwd(''); setPwdOpen(true) }}
                            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="Reset password"
                          >
                            <KeyIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(user.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete"
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
        </Card>
      )}

      {/* Create / Edit Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit User' : 'Add New User'}
        size="sm"
        footer={
          <div className="flex gap-3">
            <Button type="submit" form="user-form" variant="primary" fullWidth isLoading={saving}>
              {editing ? 'Save Changes' : 'Create User'}
            </Button>
            <Button variant="outline" fullWidth onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
          </div>
        }
      >
        <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Full Name"
            placeholder="John Doe"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            fullWidth
          />
          <Input
            label="Email"
            type="email"
            placeholder="john@restaurant.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            fullWidth
          />
          {!editing && (
            <Input
              label="Password"
              type="password"
              placeholder="Min 8 characters"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              fullWidth
            />
          )}
          <div>
            <label className="form-label">Role</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
              className="form-select w-full"
            >
              <option value="ADMIN">Admin</option>
              <option value="WAITER">Waiter</option>
              <option value="KITCHEN">Kitchen</option>
              <option value="RECEPTION">Reception</option>
            </select>
          </div>
          {form.role === 'WAITER' && (
            <div>
              <label className="form-label">Assigned tables</label>
              <p className="text-xs text-gray-500 mb-2">
                This waiter can only see and order for the ticked tables. Leave everything unselected to allow every table and pick-up.
              </p>
              {allTables.length === 0 ? (
                <p className="text-xs text-gray-400">No tables found.</p>
              ) : (
                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => setPickupAssigned((v) => !v)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${pickupAssigned ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                  >
                    📦 Pick-up
                  </button>
                  {allTables.map((t) => {
                    const on = assignedIds.includes(t.id)
                    return (
                      <button
                        type="button"
                        key={t.id}
                        onClick={() => toggleAssigned(t.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                      >
                        {t.table_number}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {editing && (
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="w-4 h-4 text-indigo-600 rounded"
              />
              <label htmlFor="is_active" className="text-sm font-medium text-gray-700">
                Active account
              </label>
            </div>
          )}
        </form>
      </Modal>

      {/* Password Reset Modal */}
      <Modal
        isOpen={pwdOpen}
        onClose={() => setPwdOpen(false)}
        title="Reset Password"
        size="sm"
        footer={
          <div className="flex gap-3">
            <Button variant="primary" fullWidth onClick={handlePasswordReset} isLoading={savingPwd}>
              Update Password
            </Button>
            <Button variant="outline" fullWidth onClick={() => setPwdOpen(false)}>
              Cancel
            </Button>
          </div>
        }
      >
        <Input
          label="New Password"
          type="password"
          placeholder="Min 8 characters"
          value={newPwd}
          onChange={(e) => setNewPwd(e.target.value)}
          fullWidth
        />
      </Modal>
    </div>
  )
}

export default Users
