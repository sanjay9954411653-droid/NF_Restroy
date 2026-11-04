/**
 * TableQRCodes — Admin page showing one QR code + passcode per table.
 *
 * Each table has its own QR token and 4-digit passcode. Scanning the QR
 * takes the customer straight to their table (no manual "pick your table"
 * step), and the passcode (printed alongside the QR) must be entered before
 * they can place an order — so a random person can't order to a table they
 * aren't actually sitting at.
 *
 * The PIN requirement can be switched on/off with the toggle at the top.
 */

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import Card from '../components/Card'
import Button from '../components/Button'
import Loading from '../components/Loading'
import {
  EyeIcon,
  EyeSlashIcon,
  ArrowPathIcon,
  PrinterIcon,
} from '@heroicons/react/24/outline'

interface Table {
  id: string
  table_number: string
  seats: number
  is_active: boolean
  qr_token: string
  passcode: string
}

function QRImage({ url, size = 220 }: { url: string; size?: number }) {
  const encoded = encodeURIComponent(url)
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}&margin=10&color=1f2937&bgcolor=ffffff`
  return <img src={src} alt="Table QR Code" width={size} height={size} className="rounded-xl border border-gray-200" />
}

const TableQRCodes: React.FC = () => {
  const [tables, setTables] = useState<Table[]>([])
  const [slug, setSlug] = useState('')
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({})
  const [passcodeRequired, setPasscodeRequired] = useState(true)
  const [savingSetting, setSavingSetting] = useState(false)

  const baseUrl = window.location.origin

  const load = () => {
    setLoading(true)
    Promise.all([
      api.get<{ success: boolean; data: Table[] }>('/tables'),
      api.get<{ success: boolean; data: { slug: string } }>('/restaurants/me'),
    ])
      .then(([tablesRes, restaurantRes]) => {
        setTables(tablesRes.data.data)
        setSlug(restaurantRes.data.data.slug)
      })
      .catch((err) => toast.error(getErrorMessage(err)))
      .finally(() => setLoading(false))

    // Loaded separately so the page still works if this fails
    api.get<{ success: boolean; data: { required: boolean } }>('/tables/passcode-setting')
      .then((res) => setPasscodeRequired(res.data.data.required !== false))
      .catch(() => {})
  }

  useEffect(() => { load() }, [])

  const toggleReveal = (id: string) => {
    setRevealed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const regenerate = async (id: string) => {
    setRegenerating((prev) => ({ ...prev, [id]: true }))
    try {
      await api.post(`/tables/${id}/regenerate-qr`)
      toast.success('New QR code and passcode generated — the old one no longer works')
      load()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setRegenerating((prev) => ({ ...prev, [id]: false }))
    }
  }

  const togglePasscode = async () => {
    const next = !passcodeRequired
    if (!next && !window.confirm(
      'Turn off the PIN?\n\nAnyone who scans a table QR code (or has its link) will be able to place orders for that table without a PIN.',
    )) {
      return
    }
    setSavingSetting(true)
    try {
      await api.put('/tables/passcode-setting', { required: next })
      setPasscodeRequired(next)
      toast.success(next ? 'PIN is now required to order' : 'PIN turned off — customers can order straight after scanning')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSavingSetting(false)
    }
  }

  const printTable = (table: Table) => {
    const url = `${baseUrl}/customer?slug=${slug}&t=${table.qr_token}`
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Table ${table.table_number} QR</title>
        <style>
          body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: white; }
          .container { text-align: center; padding: 40px; }
          h1 { font-size: 32px; font-weight: 700; color: #1f2937; margin-bottom: 4px; }
          p { font-size: 15px; color: #6b7280; margin-bottom: 24px; }
          img { border-radius: 16px; border: 2px solid #e5e7eb; }
          .pin { margin-top: 20px; font-size: 22px; font-weight: 700; letter-spacing: 4px; color: #1f2937; }
          .pin-label { font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Table ${table.table_number}</h1>
          <p>Scan to order</p>
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(url)}&margin=20&color=1f2937&bgcolor=ffffff" width="360" height="360" />
          ${passcodeRequired ? `<div class="pin-label">PIN</div><div class="pin">${table.passcode}</div>` : ''}
        </div>
      </body>
      </html>
    `
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(printContent)
      win.document.close()
      win.focus()
      setTimeout(() => win.print(), 500)
    }
  }

  if (loading) return <Loading text="Loading table QR codes…" />

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Table QR Codes</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {passcodeRequired
            ? "Each table has its own QR code and PIN. Print one per table — scanning it takes the customer straight to that table, and they'll need the PIN to place an order."
            : 'Each table has its own QR code. Print one per table — scanning it takes the customer straight to that table and they can order right away.'}
        </p>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Require PIN to order</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {passcodeRequired
                ? 'On — customers must enter the PIN printed on their table before they can order.'
                : 'Off — customers can order straight after scanning, no PIN needed.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={passcodeRequired}
            aria-label="Require PIN to order"
            disabled={savingSetting}
            onClick={togglePasscode}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-60 ${
              passcodeRequired ? 'bg-brand-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                passcodeRequired ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </Card>

      {tables.length === 0 ? (
        <Card>
          <div className="text-center py-10 text-gray-500 text-sm">
            No tables yet — add tables first on the Tables page.
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tables.map((table) => {
            const url = `${baseUrl}/customer?slug=${slug}&t=${table.qr_token}`
            const isRevealed = !!revealed[table.id]
            return (
              <Card key={table.id}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Table {table.table_number}</h3>
                  <span className="text-xs text-gray-400">{table.seats} seats</span>
                </div>
                <div className="flex justify-center mb-3">
                  <QRImage url={url} />
                </div>
                {passcodeRequired && (
                <div className="flex items-center justify-center gap-2 mb-4">
                  <span className="text-xs text-gray-400 uppercase tracking-wide">PIN:</span>
                  <span className="font-mono font-bold text-lg text-gray-900 tracking-widest">
                    {isRevealed ? table.passcode : '••••'}
                  </span>
                  <button
                    onClick={() => toggleReveal(table.id)}
                    className="text-gray-400 hover:text-gray-600"
                    title={isRevealed ? 'Hide' : 'Show'}
                  >
                    {isRevealed ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                  </button>
                </div>
                )}
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-1" onClick={() => printTable(table)}>
                    <PrinterIcon className="w-4 h-4 mr-1" />
                    Print
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    isLoading={!!regenerating[table.id]}
                    onClick={() => regenerate(table.id)}
                  >
                    <ArrowPathIcon className="w-4 h-4 mr-1" />
                    Regenerate
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default TableQRCodes
