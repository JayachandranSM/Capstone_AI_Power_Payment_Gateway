import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { LayoutDashboard, Send, Clock, RefreshCw, Wallet, User, LogOut, Shield, Bell } from 'lucide-react'
import clsx from 'clsx'

const NAV = [
  { to:'/customer',         label:'Dashboard',    icon:LayoutDashboard, end:true },
  { to:'/customer/send',    label:'Send Money',   icon:Send },
  { to:'/customer/history', label:'Transactions', icon:Clock },
  { to:'/customer/refund',  label:'Refunds',      icon:RefreshCw },
  { to:'/customer/wallet',  label:'Wallets',      icon:Wallet },
  { to:'/customer/profile', label:'Profile',      icon:User },
]

export default function CustomerLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <Shield size={18} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-slate-900 text-sm">PayGateway</div>
              <div className="text-xs text-blue-600 font-medium">Customer Portal</div>
            </div>
          </div>
        </div>
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
              {user?.full_name?.[0] ?? 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-800 truncate">{user?.full_name}</div>
              <div className="text-[10px] text-slate-400 truncate">{user?.email}</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
              )}>
              <Icon size={16} />{label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-100">
          <button onClick={() => { logout(); navigate('/login') }}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors">
            <LogOut size={16} />Sign Out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="text-sm text-slate-500">🇮🇳 UPI · INR · KYC Verified ✓</div>
          <Bell size={18} className="text-slate-400" />
        </header>
        <div className="p-6"><Outlet /></div>
      </main>
    </div>
  )
}
