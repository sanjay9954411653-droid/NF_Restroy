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
  const [email, setEmail] = useState('')
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)
  const [changeCode, setChangeCode] = useState('')
  const [changeNote, setChangeNote] = useState<string | null>(null)
  const [sendingChange, setSendingChange] = useState(false)

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

  // Changing or turning off an existing security email needs a FRESH code sent to the current email
  const needsCode = Boolean(status?.required)

  const sendChangeCode = async () => {
    setSendingChange(true)
    try {
      const res = await api.post('/menu-access/request-otp', { purpose: 'security' })
      const d = res.data.data
      setChangeNote(d.sent ? `Code sent to ${d.email_masked}` : (d.note || 'Code generated'))
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSendingChange(false)
    }
  }

  const openEmailForm = () => {
    if (showEmailForm) { setShowEmailForm(false); return }
    setEmail(''); setChangeCode(''); setChangeNote(null)
    setShowEmailForm(true)
    if (needsCode) sendChangeCode()   // the code goes to the current email right away
  }

  const saveEmail = async () => {
    setSavingEmail(true)
    try {
      if (needsCode) {
        const v = await api.post('/menu-access/verify', { code: changeCode })
        sessionStorage.setItem(TOKEN_KEY, v.data.data.token)
      }
      await api.put('/menu-access/email', { email })
      toast.success(email.trim() ? 'Security email saved' : 'Menu OTP turned off')
      setShowEmailForm(false)
      setEmail('')
      setChangeCode('')
      if (!email.trim()) sessionStorage.removeItem(TOKEN_KEY)
      await loadStatus()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSavingEmail(false)
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

  // Unlocked (or OTP not set up): show page + small security control
  return (
    <>
      <div className="flex items-center justify-end gap-2 mb-2 text-xs">
        {status?.required ? (
          <span className="text-emerald-600">🔒 Menu OTP on ({status.email_masked})</span>
        ) : (
          <span className="text-gray-500">Menu OTP is off</span>
        )}
        <button type="button" className="text-indigo-600 font-medium" onClick={openEmailForm}>
          {status?.required ? 'Change / turn off' : 'Turn on'}
        </button>
      </div>
      {showEmailForm && (
        <Card padding="sm" className="mb-3">
          <div className="space-y-2">
            <Input
              label="Main admin email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. owner@gmail.com"
              hint={status?.required ? 'New email. Leave empty to turn OTP off.' : 'An OTP will be emailed here to open the menu.'}
            />
            {needsCode && (
              <div className="space-y-1">
                <p className="text-xs text-gray-500">
                  For safety, enter the code sent to the current admin email ({status?.email_masked}).
                  {changeNote ? ` ${changeNote}.` : ''}
                </p>
                <Input
                  label="6-digit code"
                  inputMode="numeric"
                  maxLength={6}
                  value={changeCode}
                  onChange={(e) => setChangeCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••••"
                />
                <button type="button" onClick={sendChangeCode} disabled={sendingChange} className="text-xs text-indigo-600 font-medium disabled:opacity-50">
                  {sendingChange ? 'Sending…' : 'Resend code'}
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEmail} isLoading={savingEmail} disabled={needsCode && changeCode.length !== 6}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowEmailForm(false)}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}
      {children}
    </>
  )
}

export default MenuOtpGate
