import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { Send, RefreshCw, Plus, ArrowUpRight, ArrowDownLeft, AlertTriangle } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

const STATUS_COLOR: Record<string,string> = {
  success:'bg-green-100 text-green-700', failed:'bg-red-100 text-red-700',
  flagged:'bg-yellow-100 text-yellow-700', pending:'bg-blue-100 text-blue-700',
}
const FLAG: Record<string,string> = { INR:'🇮🇳',USD:'🇺🇸',EUR:'🇪🇺',GBP:'🇬🇧',SGD:'🇸🇬' }

export default function CustomerDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [wallets, setWallets] = useState<any[]>([])
  const [txns,    setTxns]    = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([axios.get('/api/v1/wallets'), axios.get('/api/v1/transactions?size=8')])
      .then(([w, t]) => { setWallets(w.data); setTxns(t.data.items || []) })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Good day, {user?.full_name?.split(' ')[0]} 👋</h1>
        <p className="text-slate-500 text-sm mt-1">Your payment overview</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {loading ? [1,2,3].map(i => <div key={i} className="h-32 bg-slate-100 rounded-2xl animate-pulse" />) :
         wallets.map(w => (
          <div key={w.id} className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-6 text-white shadow-lg">
            <div className="flex justify-between mb-4">
              <span className="text-blue-200 text-sm">{FLAG[w.currency]} {w.currency} Wallet</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/20">{w.status}</span>
            </div>
            <div className="text-3xl font-bold">{Number(w.balance).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label:'Send Money', icon:Send, to:'/customer/send', c:'blue' },
          { label:'Refund', icon:RefreshCw, to:'/customer/refund', c:'purple' },
          { label:'Add Money', icon:Plus, to:'/customer/wallet', c:'green' },
        ].map(a => (
          <button key={a.label} onClick={() => navigate(a.to)}
            className="bg-white border border-slate-100 rounded-2xl p-4 flex flex-col items-center gap-2 hover:shadow-md transition-shadow">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              a.c==='blue'?'bg-blue-100 text-blue-600':a.c==='purple'?'bg-purple-100 text-purple-600':'bg-green-100 text-green-600'}`}>
              <a.icon size={20} />
            </div>
            <span className="text-xs font-medium text-slate-700">{a.label}</span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100">
        <div className="p-4 border-b border-slate-100 flex justify-between">
          <h2 className="font-semibold text-slate-800">Recent Transactions</h2>
          <button onClick={() => navigate('/customer/history')} className="text-blue-600 text-sm hover:underline">View all →</button>
        </div>
        <div className="divide-y divide-slate-50">
          {loading ? [1,2,3].map(i => <div key={i} className="p-4 h-16 animate-pulse bg-slate-50" />) :
           txns.length === 0 ? <div className="p-8 text-center text-slate-400 text-sm">No transactions yet</div> :
           txns.map(tx => (
            <div key={tx.id} className="p-4 flex items-center gap-3 hover:bg-slate-50">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tx.type==='refund'?'bg-green-100':'bg-slate-100'}`}>
                {tx.type==='refund' ? <ArrowDownLeft size={18} className="text-green-600" /> : <ArrowUpRight size={18} className="text-slate-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{tx.upi_handle_receiver || tx.type?.replace('_',' ')}</div>
                <div className="text-xs text-slate-400">{tx.payment_method?.toUpperCase()} · {new Date(tx.created_at).toLocaleDateString()}</div>
              </div>
              {tx.fraud_score > 0.5 && <AlertTriangle size={14} className="text-yellow-500" />}
              <div className="text-right">
                <div className="text-sm font-semibold text-slate-800">{Number(tx.amount).toLocaleString()} {tx.currency}</div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLOR[tx.status]||'bg-slate-100 text-slate-600'}`}>{tx.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
