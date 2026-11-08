/**
 * DemoBanner — reminds staff that Demo / training mode is ON for this restaurant:
 * orders placed now are test orders and do not appear in reports.
 */
import { useEffect, useState } from 'react'
import api from '../api'
import { useAuth } from '../contexts/AuthContext'

const DemoBanner: React.FC = () => {
  const { user } = useAuth()
  const [on, setOn] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    api.get('/restaurants/me')
      .then((r) => { if (!cancelled) setOn(!!r.data?.data?.demo_mode) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [user])

  if (!on) return null
  return (
    <div className="bg-amber-100 border-b border-amber-300 text-amber-900 text-xs sm:text-sm px-4 py-1.5 text-center">
      <b>Demo mode is ON</b> — orders placed now are test orders and are left out of reports.
    </div>
  )
}

export default DemoBanner
