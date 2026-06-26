import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Send, Clock, RefreshCw, Wallet, User, LogOut, Bell } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import axios from 'axios'

const NAV = [
  { to: '/customer',          label: 'Dashboard',     icon: LayoutDashboard, end: true },
  { to: '/customer/send',     label: 'Send Money',    icon: Send },
  { to: '/customer/history',  label: 'Transactions',  icon: Clock },
  { to: '/customer/refund',   label: 'Refunds',       icon: RefreshCw },
  { to: '/customer/wallet',   label: 'Wallets',       icon: Wallet },
  { to: '/customer/profile',  label: 'Profile',       icon: User },
]

const TYPE_COLOR: Record<string,string> = {
  payment: 'bg-green-100 text-green-700',
  refund:  'bg-blue-100 text-blue-700',
  fraud:   'bg-red-100 text-red-700',
  dispute: 'bg-orange-100 text-orange-700',
}

export default function CustomerLayout() {
  const { user, logout } = useAuthStore()
  const navigate         = useNavigate()
  const [notifs,   setNotifs]   = useState<any[]>([])
  const [showBell, setShowBell] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)

  const loadNotifs = async () => {
    try {
      const r = await axios.get('/api/v1/notifications')
      setNotifs(r.data || [])
    } catch {}
  }

  useEffect(() => {
    loadNotifs()
    const interval = setInterval(loadNotifs, 30000) // poll every 30s
    return () => clearInterval(interval)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setShowBell(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const unread = notifs.filter(n => n.status === 'pending' && !n.read_at).length

  const markAllRead = async () => {
    try {
      await axios.patch('/api/v1/notifications/read-all')
      setNotifs(n => n.map(x => ({ ...x, read_at: new Date().toISOString() })))
    } catch {}
  }

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-100 flex flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-sm">PG</span>
            </div>
            <div>
              <div className="font-bold text-slate-800">PayGateway</div>
              <div className="text-xs text-blue-600">Customer Portal</div>
            </div>
          </div>
        </div>

        {/* User */}
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
              {user?.full_name?.[0] || 'U'}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-slate-800 text-sm truncate">{user?.full_name}</div>
              <div className="text-xs text-slate-400 truncate">{user?.email}</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                }`
              }>
              <Icon size={18}/>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Sign out */}
        <div className="p-3 border-t border-slate-100">
          <button onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 w-full transition-colors">
            <LogOut size={18}/>Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-100 px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-slate-500">
            🇮🇳 UPI · {user?.preferred_currency || 'INR'} · KYC Verified ✓
          </div>

          {/* Notification Bell */}
          <div className="relative" ref={bellRef}>
            <button
              onClick={() => { setShowBell(!showBell); if (!showBell) loadNotifs() }}
              className="relative p-2 rounded-xl hover:bg-slate-50 transition-colors">
              <Bell size={20} className="text-slate-500"/>
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            {/* Dropdown */}
            {showBell && (
              <div className="absolute right-0 top-12 w-96 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <span className="font-semibold text-slate-800">
                    Notifications {unread > 0 && <span className="text-red-500">({unread} new)</span>}
                  </span>
                  {unread > 0 && (
                    <button onClick={markAllRead}
                      className="text-xs text-blue-600 hover:text-blue-500">
                      Mark all read
                    </button>
                  )}
                </div>

                {/* Notification list */}
                <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
                  {notifs.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-sm">
                      No notifications yet
                    </div>
                  ) : notifs.slice(0, 15).map(n => (
                    <div key={n.id}
                      className={`px-4 py-3 hover:bg-slate-50 transition-colors ${!n.read_at ? 'bg-blue-50/30' : ''}`}>
                      <div className="flex items-start gap-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 mt-0.5 ${TYPE_COLOR[n.type] || 'bg-slate-100 text-slate-600'}`}>
                          {n.type}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-sm font-medium ${!n.read_at ? 'text-slate-900' : 'text-slate-600'}`}>
                              {n.title}
                            </span>
                            {!n.read_at && (
                              <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"/>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">{n.body}</div>
                          <div className="text-[10px] text-slate-400 mt-1">
                            {new Date(n.created_at).toLocaleString('en-IN', {
                              day:'2-digit', month:'short',
                              hour:'2-digit', minute:'2-digit'
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {notifs.length > 0 && (
                  <div className="px-4 py-2 border-t border-slate-100 text-center">
                    <span className="text-xs text-slate-400">{notifs.length} total notifications</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet/>
        </main>
      </div>
    </div>
  )
}
