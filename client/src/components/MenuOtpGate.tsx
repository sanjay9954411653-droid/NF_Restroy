import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
  email_masked: string | null
  email_configured: boolean
}

/**
 * Wraps the Menu page. When the restaurant has a security email set,
 * an ADMIN must enter an OTP (sent to that email) before the page opens.
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

  // The menu is only unlocked while this page is open: leaving it (or closing the tab) locks it again,
  // so the next visit asks for a new code.
  useEffect(() => {
    const relock = () => { try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* storage blocked */ } }
    window.addEventListener('pagehide', relock)
    return () => { window.removeEventListener('pagehide', relock); relock() }
  }, [])

  // Non-admins (or if status can't be loaded) pass straight through; the server still protects menu changes.
  if (!isAdmin) return <>{children}</>
  if (loading) return <Loading />

  const sendOtp = async () => {
    setSending(true)
    try {
      const res = await api.post('/menu-access/request-otp')
      setSentNote(res.data.data.sent ? `Code sent to ${res.data.data.email_masked}` : (res.data.data.note || 'Code generated'))
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

  // Locked: OTP required and not yet verified
  if (status?.required && !status.verified) {
    return (
      <div className="max-w-md mx-auto mt-10">
        <Card padding="md">
          <div className="space-y-4 text-center">
            <div className="text-4xl">🔐</div>
            <h2 className="text-lg font-bold text-gray-900">Menu is locked</h2>
            <p className="text-sm text-gray-500">
              Enter the OTP emailed to the main admin: {status.email_masked}.
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

  // Unlocked (or OTP not set up): show the page. The admin email is managed on the Security page only.
  return (
    <>
      <div className="flex items-center justify-end gap-2 mb-2 text-xs">
        {status?.required ? (
          <span className="text-emerald-600">🔒 Menu OTP on ({status.email_masked})</span>
        ) : (
          <span className="text-gray-500">
            Menu OTP is off — <Link to="/security" className="text-indigo-600 font-medium">turn it on in Security</Link>
          </span>
        )}
      </div>
      {children}
    </>
  )
}

export default MenuOtpGate
