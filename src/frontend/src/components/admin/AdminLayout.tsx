import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { LayoutDashboard, ShieldAlert, FileText, Search, Users, LogOut, Shield, TrendingUp, RefreshCw } from 'lucide-react'
import clsx from 'clsx'

const NAV = [
  {to:'/admin',label:'Dashboard',icon:LayoutDashboard,end:true},
  {to:'/admin/fraud',label:'Fraud Queue',icon:ShieldAlert},
  {to:'/admin/disputes',label:'Disputes',icon:FileText},
  {to:'/admin/nlp',label:'NLP Lookup',icon:Search},
  {to:'/admin/users',label:'Users',icon:Users},
  {to:'/admin/analytics',label:'Analytics',icon:TrendingUp},
  {to:'/admin/refunds',label:'Refunds',icon:RefreshCw},
]

export default function AdminLayout() {
  const { user, logout } = useAuthStore(); const navigate = useNavigate()
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <aside className="w-64 bg-slate-900 flex flex-col">
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-red-600 rounded-xl flex items-center justify-center"><Shield size={18} className="text-white"/></div>
            <div><div className="font-bold text-white text-sm">PayGateway</div><div className="text-xs text-red-400 font-medium">Admin Panel</div></div>
          </div>
        </div>
        <div className="px-4 py-3 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-red-400 to-orange-500 rounded-full flex items-center justify-center text-white text-xs font-bold">{user?.full_name?.[0]??'A'}</div>
            <div className="flex-1 min-w-0"><div className="text-xs font-semibold text-white truncate">{user?.full_name}</div><div className="text-[10px] text-slate-400 truncate">System Administrator</div></div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map(({to,label,icon:Icon,end})=>(
            <NavLink key={to} to={to} end={end}
              className={({isActive})=>clsx('flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                isActive?'bg-red-600 text-white':'text-slate-400 hover:bg-slate-800 hover:text-white')}>
              <Icon size={16}/>{label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-700">
          <button onClick={()=>{logout();navigate('/login')}} className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors">
            <LogOut size={16}/>Sign Out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10">
          <div className="text-sm text-slate-500">🛡️ Sara Chen · Support Administrator · Singapore · Sandbox Mode</div>
        </header>
        <div className="p-6"><Outlet/></div>
      </main>
    </div>
  )
}
