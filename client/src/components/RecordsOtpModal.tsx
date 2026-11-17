import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import { finishRecordsOtp } from '../lib/recordsOtp'
import Button from './Button'
import Input from './Input'

/** Popup that appears when editing/deleting a recorded order or payment needs the admin-email OTP. */
const RecordsOtpModal: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)

  const sendOtp = async () => {
    setSending(true)
    try {
      const res = await api.post('/menu-access/records/request-otp')
      const d = res.data.data
      setNote(d.sent ? `Code sent to ${d.email_masked}` : (d.note || 'Code generated'))
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    const onNeeded = () => { setCode(''); setNote(null); setOpen(true); sendOtp() }
    window.addEventListener('records-otp-needed', onNeeded)
    return () => window.removeEventListener('records-otp-needed', onNeeded)
  }, [])

  const close = (token: string | null) => { setOpen(false); finishRecordsOtp(token) }

  const verify = async () => {
    setVerifying(true)
    try {
      const res = await api.post('/menu-access/records/verify', { code })
      close(res.data.data.token)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setVerifying(false)
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3 text-center">
        <div className="text-3xl">🔐</div>
        <h2 className="text-lg font-bold text-gray-900">Admin OTP needed</h2>
        <p className="text-sm text-gray-500">
          Changing or deleting a recorded order or payment needs the code emailed to the main admin.
        </p>
        {note && <p className="text-xs text-gray-500">{note}</p>}
        <Input
          label="6-digit code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="••••••"
        />
        <Button onClick={verify} isLoading={verifying} disabled={code.length !== 6} fullWidth>Confirm</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={sendOtp} isLoading={sending} fullWidth>Resend code</Button>
          <Button variant="ghost" onClick={() => close(null)} fullWidth>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

export default RecordsOtpModal
