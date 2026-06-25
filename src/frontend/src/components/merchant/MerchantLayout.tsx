import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { LayoutDashboard, Receipt, Banknote, MessageSquare, LogOut, Shield } from 'lucide-react'
import clsx from 'clsx'

const NAV = [
  {to:'/merchant',label:'Dashboard',icon:LayoutDashboard,end:true},
  {to:'/merchant/transactions',label:'Transactions',icon:Receipt},
  {to:'/merchant/settlements',label:'Settlements',icon:Banknote},
  {to:'/merchant/ai-support',label:'AI Support',icon:MessageSquare},
]

export default function MerchantLayout() {
  const { user, logout } = useAuthStore(); const navigate = useNavigate()
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-600 rounded-xl flex items-center justify-center"><Shield size={18} className="text-white"/></div>
            <div><div className="font-bold text-slate-900 text-sm">PayGateway</div><div className="text-xs text-emerald-600 font-medium">Merchant Portal</div></div>
          </div>
        </div>
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center text-white text-xs font-bold">{user?.full_name?.[0]??'M'}</div>
            <div className="flex-1 min-w-0"><div className="text-xs font-semibold text-slate-800 truncate">{user?.full_name}</div><div className="text-[10px] text-slate-400 truncate">{user?.email}</div></div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map(({to,label,icon:Icon,end})=>(
            <NavLink key={to} to={to} end={end}
              className={({isActive})=>clsx('flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                isActive?'bg-emerald-50 text-emerald-700':'text-slate-600 hover:bg-slate-50')}>
              <Icon size={16}/>{label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-100">
          <button onClick={()=>{logout();navigate('/login')}} className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors">
            <LogOut size={16}/>Sign Out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10">
          <div className="text-sm text-slate-500">🏪 Raj Electronics · Merchant Account · Sandbox Mode</div>
        </header>
        <div className="p-6"><Outlet/></div>
      </main>
    </div>
  )
}
