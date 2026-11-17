import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import { useAuth } from '../contexts/AuthContext'
import Button from './Button'
import Card from './Card'
import Input from './Input'
import Loading from './Loading'

const TOKEN_KEY = 'menu_otp_token'

interface Status {
  required: boolean
  verified: boolean
  phone_masked: string | null
  sms_configured: boolean
}

/**
 * Wraps the Menu page. When the restaurant has a security phone number set,
 * an ADMIN must enter an OTP (sent to that number) before the page opens.
 */
const MenuOtpGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [sentNote, setSentNote] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('')
  const [showPhoneForm, setShowPhoneForm] = useState(false)
  const [savingPhone, setSavingPhone] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const res = await api.get('/menu-access/status')
      setStatus(res.data.data)
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return }
    loadStatus()
  }, [isAdmin, loadStatus])

  // Non-admins (or if status can't be loaded) pass straight through; the server still protects menu changes.
  if (!isAdmin) return <>{children}</>
  if (loading) return <Loading />

  const sendOtp = async () => {
    setSending(true)
    try {
      const res = await api.post('/menu-access/request-otp')
      setSentNote(res.data.data.sent ? `Code sent to ${res.data.data.phone_masked}` : (res.data.data.note || 'Code generated'))
      toast.success('OTP requested')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSending(false)
    }
  }

  const verify = async () => {
    setVerifying(true)
    try {
      const res = await api.post('/menu-access/verify', { code })
      sessionStorage.setItem(TOKEN_KEY, res.data.data.token)
      setCode('')
      await loadStatus()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setVerifying(false)
    }
  }

  const savePhone = async () => {
    setSavingPhone(true)
    try {
      await api.put('/menu-access/phone', { phone })
      toast.success(phone.trim() ? 'Security phone saved' : 'Menu OTP turned off')
      setShowPhoneForm(false)
      setPhone('')
      if (!phone.trim()) sessionStorage.removeItem(TOKEN_KEY)
      await loadStatus()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSavingPhone(false)
    }
  }

  // Locked: OTP required and not yet verified
  if (status?.required && !status.verified) {
    return (
      <div className="max-w-md mx-auto mt-10">
        <Card padding="md">
          <div className="space-y-4 text-center">
            <div className="text-4xl">🔐</div>
            <h2 className="text-lg font-bold text-gray-900">Menu is locked</h2>
            <p className="text-sm text-gray-500">
              Enter the OTP sent to the main admin phone {status.phone_masked}.
            </p>
            <Button onClick={sendOtp} isLoading={sending} fullWidth variant="outline">
              {sentNote ? 'Resend OTP' : 'Send OTP'}
            </Button>
            {sentNote && <p className="text-xs text-gray-500">{sentNote}</p>}
            <Input
              label="6-digit code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
            />
            <Button onClick={verify} isLoading={verifying} disabled={code.length !== 6} fullWidth>
              Unlock menu
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  // Unlocked (or OTP not set up): show page + small security control
  return (
    <>
      <div className="flex items-center justify-end gap-2 mb-2 text-xs">
        {status?.required ? (
          <span className="text-emerald-600">🔒 Menu OTP on ({status.phone_masked})</span>
        ) : (
          <span className="text-gray-500">Menu OTP is off</span>
        )}
        <button type="button" className="text-indigo-600 font-medium" onClick={() => setShowPhoneForm((v) => !v)}>
          {status?.required ? 'Change / turn off' : 'Turn on'}
        </button>
      </div>
      {showPhoneForm && (
        <Card padding="sm" className="mb-3">
          <div className="space-y-2">
            <Input
              label="Main admin phone number"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 9876543210"
              hint={status?.required ? 'Leave empty and save to turn OTP off.' : 'OTP will be sent to this number to open the menu.'}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={savePhone} isLoading={savingPhone}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowPhoneForm(false)}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}
      {children}
    </>
  )
}

export default MenuOtpGate
