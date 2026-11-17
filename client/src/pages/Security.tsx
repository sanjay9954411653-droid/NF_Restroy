import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import Loading from '../components/Loading'

const TOKEN_KEY = 'menu_otp_token'

interface Status {
  required: boolean
  verified: boolean
  email_masked: string | null
  email_configured: boolean
}

/**
 * Admin security email. This one address receives the OTP for the Menu page and for
 * editing / deleting recorded orders and payments. Adding it the first time is free;
 * changing or removing it needs an OTP sent to the CURRENT email.
 */
const Security: React.FC = () => {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/menu-access/status')
      setStatus(res.data.data)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <Loading />

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (err) { toast.error(getErrorMessage(err)) } finally { setBusy(false) }
  }

  const sendOtp = () => run(async () => {
    const res = await api.post('/menu-access/request-otp')
    const d = res.data.data
    setNote(d.sent ? `Code sent to ${d.email_masked}` : (d.note || 'Code generated'))
  })

  const verify = () => run(async () => {
    const res = await api.post('/menu-access/verify', { code })
    sessionStorage.setItem(TOKEN_KEY, res.data.data.token)
    setCode('')
    setNote(null)
    await load()
  })

  const save = (value: string) => run(async () => {
    await api.put('/menu-access/email', { email: value })
    toast.success(value.trim() ? 'Admin email saved' : 'Admin email removed')
    setEmail('')
    if (!value.trim()) sessionStorage.removeItem(TOKEN_KEY)
    await load()
  })

  const hasEmail = Boolean(status?.required)
  const unlocked = Boolean(status?.verified)

  return (
    <div className="max-w-lg space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Security</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          The admin email gets the OTP for the Menu page and for editing or deleting recorded orders and payments.
        </p>
      </div>

      <Card padding="md">
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Admin email:{' '}
            <span className="font-semibold">{hasEmail ? status?.email_masked : 'not set (everything is unlocked)'}</span>
          </p>

          {!hasEmail && (
            <>
              <Input
                label="Admin Gmail"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. owner@gmail.com"
              />
              <Button onClick={() => save(email)} isLoading={busy} disabled={!email.trim()}>Save email</Button>
            </>
          )}

          {hasEmail && !unlocked && (
            <div className="space-y-3 border-t border-gray-100 pt-3">
              <p className="text-sm text-gray-500">To change or remove it, first confirm with a code sent to the current email.</p>
              <Button variant="outline" onClick={sendOtp} isLoading={busy}>{note ? 'Resend code' : 'Send code'}</Button>
              {note && <p className="text-xs text-gray-500">{note}</p>}
              <Input
                label="6-digit code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
              />
              <Button onClick={verify} isLoading={busy} disabled={code.length !== 6}>Confirm</Button>
            </div>
          )}

          {hasEmail && unlocked && (
            <div className="space-y-3 border-t border-gray-100 pt-3">
              <Input
                label="New admin Gmail"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. newowner@gmail.com"
              />
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => save(email)} isLoading={busy} disabled={!email.trim()}>Change email</Button>
                <Button variant="outline" onClick={() => { if (window.confirm('Remove the admin email? Menu and records will no longer need an OTP.')) save('') }} disabled={busy}>
                  Remove (turn OTP off)
                </Button>
              </div>
            </div>
          )}

          {status && !status.email_configured && (
            <p className="text-xs text-amber-600">
              Email sending is not set up on the server yet, so codes are only printed in the server logs.
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}

export default Security
