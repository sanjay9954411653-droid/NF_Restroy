import { useLocation, useNavigate } from 'react-router-dom'
import {
  TableCellsIcon,
  ClipboardDocumentListIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import {
  TableCellsIcon as TableCellsSolid,
  ClipboardDocumentListIcon as ClipboardSolid,
  UserCircleIcon as UserCircleSolid,
} from '@heroicons/react/24/solid'
import { useOrderStore } from '../store/useOrderStore'
import { getReadyRounds, isIncomingPending } from '../lib/orderRounds'

const BottomNav: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { queue, orders } = useOrderStore()
  const readyToServe = orders.reduce((n, o) => n + getReadyRounds(o).length, 0)
  const incoming = orders.filter(isIncomingPending).length // customer orders waiting to be accepted

  const tabs = [
    {
      label: 'Tables',
      path: '/',
      icon: TableCellsIcon,
      activeIcon: TableCellsSolid,
    },
    {
      label: 'Orders',
      path: '/orders',
      icon: ClipboardDocumentListIcon,
      activeIcon: ClipboardSolid,
      badge: readyToServe + queue.length + incoming > 0 ? readyToServe + queue.length + incoming : undefined,
      badgeColor: incoming > 0 ? 'bg-red-500' : readyToServe > 0 ? 'bg-emerald-500' : 'bg-amber-500',
    },
    {
      label: 'Profile',
      path: '/profile',
      icon: UserCircleIcon,
      activeIcon: UserCircleSolid,
    },
  ]

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 flex safe-area-pb z-20">
      {tabs.map((tab) => {
        const isActive = location.pathname === tab.path
        const Icon = isActive ? tab.activeIcon : tab.icon
        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 relative transition-colors ${
              isActive ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Icon className="w-6 h-6" />
            <span className="text-xs font-medium">{tab.label}</span>
            {tab.badge && (
              <span className={`absolute top-2 right-1/4 w-4 h-4 ${(tab as any).badgeColor || 'bg-amber-500'} text-white text-xs rounded-full flex items-center justify-center font-bold`}>
                {tab.badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

export default BottomNav
