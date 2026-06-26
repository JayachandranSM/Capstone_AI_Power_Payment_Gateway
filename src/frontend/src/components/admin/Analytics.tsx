import { useEffect, useState } from 'react'
import axios from 'axios'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts'
import { TrendingUp, AlertTriangle, Shield, Activity } from 'lucide-react'

const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899']

export default function Analytics() {
  const [data,    setData]    = useState<any>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    axios.get('/api/v1/admin/analytics')
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [])

  const s           = data.summary || {}
  const trend       = (data.daily_trend || []).map((d: any) => ({
    date:     new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    volume:   Math.round(parseFloat(d.volume_usd || 0)),
    count:    parseInt(d.count || 0),
    forecast: Math.round(parseFloat(d.volume_usd || 0) * 1.05),
  }))
  const currencies  = data.currency_breakdown || []

  const kpis = [
    { label: 'Total Volume (USD)', value: `$${parseFloat(s.total_volume_usd||0).toLocaleString('en',{maximumFractionDigits:0})}`, icon: TrendingUp, c: 'bg-blue-100 text-blue-600' },
    { label: 'Avg Fraud Score',    value: s.avg_fraud_score ? `${(s.avg_fraud_score*100).toFixed(1)}%` : '—',                    icon: AlertTriangle, c: 'bg-red-100 text-red-600' },
    { label: 'Chargebacks',        value: s.total_chargebacks || 0,                                                               icon: Shield,        c: 'bg-orange-100 text-orange-600' },
    { label: 'Success Rate',       value: s.total_transactions ? `${((s.success_count/s.total_transactions)*100).toFixed(1)}%` : '—', icon: Activity, c: 'bg-green-100 text-green-600' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Predictive Analytics</h1>
        <p className="text-slate-500 text-sm mt-1">Platform intelligence · Last 30 days · Settlement forecasting</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(k => { const Icon = k.icon; return (
          <div key={k.label} className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${k.c}`}><Icon size={18}/></div>
            <div className="text-2xl font-bold text-slate-900">{loading ? '…' : k.value}</div>
            <div className="text-xs text-slate-400 mt-0.5">{k.label}</div>
          </div>
        )})}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Volume + Forecast */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="font-semibold text-slate-800 mb-1">Volume vs Forecast (USD)</h2>
          <p className="text-xs text-slate-400 mb-4">Blue = actual · Green = +5% trend forecast</p>
          {trend.length === 0
            ? <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Insufficient data</div>
            : <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="date" tick={{fontSize:10,fill:'#94a3b8'}}/>
                  <YAxis tick={{fontSize:10,fill:'#94a3b8'}}/>
                  <Tooltip formatter={(v:any,n:any) => [`$${Number(v).toLocaleString()}`, n]}/>
                  <Bar dataKey="volume"   fill="#3b82f6" radius={[4,4,0,0]} name="Actual"/>
                  <Bar dataKey="forecast" fill="#10b981" radius={[4,4,0,0]} name="Forecast" opacity={0.7}/>
                </BarChart>
              </ResponsiveContainer>
          }
        </div>

        {/* Currency breakdown */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="font-semibold text-slate-800 mb-4">Currency Distribution</h2>
          {currencies.length === 0
            ? <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No data</div>
            : <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={currencies} cx="50%" cy="50%" outerRadius={65}
                         dataKey="count" nameKey="currency" labelLine={false}>
                      {currencies.map((_:any,i:number) =>
                        <Cell key={i} fill={COLORS[i % COLORS.length]}/>
                      )}
                    </Pie>
                    <Tooltip/>
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {currencies.slice(0,6).map((c:any,i:number) => (
                    <div key={c.currency} className="flex items-center gap-1.5 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:COLORS[i%COLORS.length]}}/>
                      <span className="text-slate-600">{c.currency}</span>
                      <span className="text-slate-400 ml-auto">{c.count}</span>
                    </div>
                  ))}
                </div>
              </>
          }
        </div>
      </div>

      {/* Transaction trend line */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="font-semibold text-slate-800 mb-4">Daily Transaction Count</h2>
        {trend.length === 0
          ? <div className="h-32 flex items-center justify-center text-slate-400 text-sm">No data</div>
          : <ResponsiveContainer width="100%" height={150}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                <XAxis dataKey="date" tick={{fontSize:10,fill:'#94a3b8'}}/>
                <YAxis tick={{fontSize:10,fill:'#94a3b8'}}/>
                <Tooltip formatter={(v:any) => [v, 'Transactions']}/>
                <Line type="monotone" dataKey="count" stroke="#8b5cf6" dot={false} strokeWidth={2}/>
              </LineChart>
            </ResponsiveContainer>
        }
      </div>

      {/* Chargeback probability model */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="font-semibold text-slate-800 mb-2">Chargeback Probability Model</h2>
        <p className="text-slate-500 text-xs mb-4">
          Formula: P(chargeback) = fraud_score × 0.4 + 0.02 base rate
        </p>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label:'Low Risk (fraud score < 0.3)',   prob:'2–14%',  color:'bg-green-100 text-green-700',  bar:'w-1/6 bg-green-500' },
            { label:'Medium Risk (score 0.3–0.6)',    prob:'14–26%', color:'bg-yellow-100 text-yellow-700', bar:'w-1/3 bg-yellow-500' },
            { label:'High Risk (score > 0.6)',         prob:'> 26%',  color:'bg-red-100 text-red-700',      bar:'w-2/3 bg-red-500' },
          ].map(r => (
            <div key={r.label} className={`rounded-xl p-4 ${r.color}`}>
              <div className="text-lg font-bold mb-1">{r.prob}</div>
              <div className="text-xs">{r.label}</div>
              <div className="mt-2 bg-white/50 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full ${r.bar}`}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sandbox payment status */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="font-semibold text-slate-800 mb-3">Sandbox Provider Status</h2>
        <SandboxStatus />
      </div>
    </div>
  )
}

function SandboxStatus() {
  const [status, setStatus] = useState<any>(null)
  useEffect(() => {
    axios.get('/api/v1/sandbox/status').then(r => setStatus(r.data)).catch(() => {})
  }, [])

  if (!status) return <div className="text-slate-400 text-sm">Loading...</div>

  return (
    <div className="flex items-center gap-4">
      <div className={`w-3 h-3 rounded-full ${status.connected ? 'bg-green-500' : 'bg-yellow-500'}`}/>
      <div>
        <div className="text-sm font-medium text-slate-800">
          {status.provider} · {status.mode}
          <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${status.connected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
            {status.connected ? 'Connected' : 'Mock Mode'}
          </span>
        </div>
        <div className="text-xs text-slate-400 mt-0.5">Key: {status.key_id} · Features: {status.features?.join(', ')}</div>
      </div>
    </div>
  )
}
