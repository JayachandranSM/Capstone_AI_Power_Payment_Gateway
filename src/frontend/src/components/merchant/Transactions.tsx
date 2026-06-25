import { useEffect, useState } from 'react'
import axios from 'axios'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function MerchantTransactions() {
  const [data, setData] = useState<any>({})
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const fetch = async (p=1) => {
    setLoading(true)
    try { const r = await axios.get(`/api/v1/merchants/transactions?page=${p}&size=20`); setData(r.data); setPage(p) }
    finally { setLoading(false) }
  }
  useEffect(()=>{fetch()},[])

  const stats = data?.stats||{}; const txns = data?.transactions||[]

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">Transactions</h1><p className="text-slate-500 text-sm mt-1">All payments received</p></div>
      <div className="grid grid-cols-4 gap-4">
        {[{l:'Total',v:stats.total||0},{l:'Success',v:stats.success_count||0,c:'text-green-600'},{l:'Failed',v:stats.failed_count||0,c:'text-red-600'},{l:'Revenue',v:`₹${parseFloat(stats.total_revenue||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`,c:'text-emerald-600'}].map(s=>(
          <div key={s.l} className="bg-white rounded-2xl border border-slate-100 p-4">
            <div className={`text-xl font-bold ${s.c||'text-slate-900'}`}>{s.v}</div>
            <div className="text-xs text-slate-400 mt-0.5">{s.l}</div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>{['Customer','Method','Amount','Status','Settlement','Date'].map(h=><th key={h} className="text-left px-4 py-3 text-xs text-slate-500 font-semibold uppercase">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading?Array.from({length:8}).map((_,i)=><tr key={i}>{Array.from({length:6}).map((_,j)=><td key={j} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse"/></td>)}</tr>):
               txns.map((tx:any)=>(
                <tr key={tx.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><div className="font-medium text-slate-800">{tx.sender_name||'—'}</div><div className="text-xs text-slate-400 font-mono">{tx.id?.slice(0,8).toUpperCase()}</div></td>
                  <td className="px-4 py-3 text-xs text-slate-500 uppercase">{tx.payment_method}</td>
                  <td className="px-4 py-3 font-semibold">₹{parseFloat(tx.amount||0).toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tx.status==='success'?'bg-green-100 text-green-700':tx.status==='failed'?'bg-red-100 text-red-700':'bg-yellow-100 text-yellow-700'}`}>{tx.status}</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${tx.settlement_status==='settled'?'bg-green-100 text-green-700':'bg-slate-100 text-slate-600'}`}>{tx.settlement_status||'pending'}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-400">{new Date(tx.created_at).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-100 flex justify-between items-center">
          <span className="text-xs text-slate-400">Page {page}</span>
          <div className="flex gap-2">
            <button disabled={page<=1} onClick={()=>fetch(page-1)} className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40"><ChevronLeft size={14}/></button>
            <button onClick={()=>fetch(page+1)} className="p-1.5 rounded-lg border border-slate-200"><ChevronRight size={14}/></button>
          </div>
        </div>
      </div>
    </div>
  )
}
