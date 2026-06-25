import { useEffect, useState } from 'react'
import axios from 'axios'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { TrendingUp, ShoppingBag, AlertTriangle, CheckCircle } from 'lucide-react'

export default function MerchantDashboard() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { axios.get('/api/v1/merchants/transactions?size=30').then(r=>setData(r.data)).finally(()=>setLoading(false)) }, [])

  if (loading) return <div className="space-y-4 animate-pulse">{[1,2,3].map(i=><div key={i} className="h-24 bg-slate-100 rounded-2xl"/>)}</div>

  const stats = data?.stats||{}
  const txns  = data?.transactions||[]
  const dayMap: Record<string,number> = {}
  txns.forEach((t:any)=>{ if(t.status==='success'){ const d=new Date(t.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}); dayMap[d]=(dayMap[d]||0)+parseFloat(t.amount||0) } })
  const chartData = Object.entries(dayMap).slice(-7).map(([date,revenue])=>({date,revenue:Math.round(revenue)}))
  const pie = [{name:'Success',value:stats.success_count||0},{name:'Failed',value:stats.failed_count||0},{name:'Flagged',value:stats.flagged_count||0}]

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">Merchant Dashboard</h1><p className="text-slate-500 text-sm mt-1">Business performance overview</p></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {label:'Total Revenue',value:`₹${parseFloat(stats.total_revenue||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`,icon:TrendingUp,c:'bg-emerald-100 text-emerald-600'},
          {label:'Total Orders',value:stats.total||0,icon:ShoppingBag,c:'bg-blue-100 text-blue-600'},
          {label:'Success Rate',value:stats.total?`${((stats.success_count/stats.total)*100).toFixed(1)}%`:'—',icon:CheckCircle,c:'bg-green-100 text-green-600'},
          {label:'Flagged',value:stats.flagged_count||0,icon:AlertTriangle,c:'bg-yellow-100 text-yellow-600'},
        ].map(c=>{ const Icon=c.icon; return (
          <div key={c.label} className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${c.c}`}><Icon size={18}/></div>
            <div className="text-2xl font-bold text-slate-900">{c.value}</div>
            <div className="text-xs text-slate-400 mt-0.5">{c.label}</div>
          </div>
        )})}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="font-semibold text-slate-800 mb-4">Revenue (Last 7 Days)</h2>
          {chartData.length===0?<div className="h-48 flex items-center justify-center text-slate-400 text-sm">No data yet</div>:(
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                <XAxis dataKey="date" tick={{fontSize:11,fill:'#94a3b8'}}/>
                <YAxis tick={{fontSize:11,fill:'#94a3b8'}}/>
                <Tooltip formatter={(v:any)=>[`₹${Number(v).toLocaleString()}`,'Revenue']}/>
                <Bar dataKey="revenue" fill="#10b981" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="font-semibold text-slate-800 mb-4">Transaction Mix</h2>
          <ResponsiveContainer width="100%" height={140}>
            <PieChart><Pie data={pie} cx="50%" cy="50%" outerRadius={60} dataKey="value">
              {pie.map((_,i)=><Cell key={i} fill={['#10b981','#ef4444','#f59e0b'][i]}/>)}
            </Pie><Tooltip/></PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-2">
            {pie.map((p,i)=>(
              <div key={p.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{background:['#10b981','#ef4444','#f59e0b'][i]}}/><span className="text-slate-600">{p.name}</span></div>
                <span className="font-semibold text-slate-800">{p.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
