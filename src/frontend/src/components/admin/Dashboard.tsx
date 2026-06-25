import { useEffect, useState } from 'react'
import axios from 'axios'
import { Users, ShieldAlert, TrendingUp, Activity } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

export default function AdminDashboard() {
  const [txns, setTxns] = useState<any[]>([])
  const [alerts, setAlerts] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [analytics, setAnalytics] = useState<any>({})
  const [loading, setLoading] = useState(true)

  useEffect(()=>{
    Promise.all([
      axios.get('/api/v1/transactions?size=30'),
      axios.get('/api/v1/admin/fraud-alerts?status=open'),
      axios.get('/api/v1/admin/users?size=8'),
      axios.get('/api/v1/admin/analytics'),
    ]).then(([t,a,u,an])=>{ setTxns(t.data.items||[]); setAlerts(a.data||[]); setUsers(u.data||[]); setAnalytics(an.data||{}) })
    .finally(()=>setLoading(false))
  },[])

  const s = analytics.summary||{}
  const trend = (analytics.daily_trend||[]).map((d:any)=>({date:new Date(d.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}),volume:Math.round(parseFloat(d.volume_usd||0)),count:d.count}))

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1><p className="text-slate-500 text-sm mt-1">Platform-wide overview — last 30 days</p></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {label:'Total Transactions',value:s.total_transactions||0,icon:TrendingUp,c:'bg-blue-100 text-blue-600'},
          {label:'Open Fraud Alerts',value:alerts.length,icon:ShieldAlert,c:'bg-red-100 text-red-600'},
          {label:'Total Users',value:users.length,icon:Users,c:'bg-purple-100 text-purple-600'},
          {label:'Avg Fraud Score',value:s.avg_fraud_score?`${(s.avg_fraud_score*100).toFixed(1)}%`:'—',icon:Activity,c:'bg-orange-100 text-orange-600'},
        ].map(c=>{ const Icon=c.icon; return (
          <div key={c.label} className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${c.c}`}><Icon size={18}/></div>
            <div className="text-2xl font-bold text-slate-900">{loading?'…':c.value}</div>
            <div className="text-xs text-slate-400 mt-0.5">{c.label}</div>
          </div>
        )})}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="font-semibold text-slate-800 mb-4">Daily Volume (USD) — Last 7 Days</h2>
          {trend.length===0?<div className="h-48 flex items-center justify-center text-slate-400 text-sm">No data</div>:(
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                <XAxis dataKey="date" tick={{fontSize:10,fill:'#94a3b8'}}/>
                <YAxis tick={{fontSize:10,fill:'#94a3b8'}}/>
                <Tooltip formatter={(v:any)=>[`$${Number(v).toLocaleString()}`,'Volume']}/>
                <Line type="monotone" dataKey="volume" stroke="#3b82f6" dot={false} strokeWidth={2}/>
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="font-semibold text-slate-800 mb-4">Top Fraud Alerts</h2>
          {loading?<div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse"/>)}</div>:
           alerts.length===0?<div className="text-center text-slate-400 py-8 text-sm">No open alerts 🎉</div>:
           alerts.slice(0,5).map((a:any)=>(
            <div key={a.id} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
              <div><div className="text-sm font-medium text-slate-800">{a.sender_name||'Unknown'}</div><div className="text-xs text-slate-400">₹{parseFloat(a.amount||0).toLocaleString()} · {a.payment_method}</div></div>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${a.severity==='critical'?'bg-red-100 text-red-700':a.severity==='high'?'bg-orange-100 text-orange-700':'bg-yellow-100 text-yellow-700'}`}>
                {(a.fraud_score*100).toFixed(0)}% · {a.severity}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-100">
        <div className="p-4 border-b border-slate-100"><h2 className="font-semibold text-slate-800">Recent Users</h2></div>
        <div className="divide-y divide-slate-50">
          {users.slice(0,6).map((u:any)=>(
            <div key={u.id} className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-xs font-bold">{u.full_name?.[0]}</div>
                <div><div className="text-sm font-medium text-slate-800">{u.full_name}</div><div className="text-xs text-slate-400">{u.email}</div></div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${u.role==='admin'?'bg-red-100 text-red-700':u.role==='merchant'?'bg-emerald-100 text-emerald-700':'bg-blue-100 text-blue-700'}`}>{u.role}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${u.kyc_status==='verified'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-700'}`}>{u.kyc_status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
