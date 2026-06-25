import { useEffect, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Loader2, Sparkles } from 'lucide-react'

export default function Settlements() {
  const [settlements, setS] = useState<any[]>([])
  const [aiSummary, setAI]  = useState('')
  const [aiLoad, setAL]     = useState(false)
  const [loading, setLoad]  = useState(true)

  useEffect(()=>{ axios.get('/api/v1/merchants/settlements').then(r=>setS(r.data||[])).finally(()=>setLoad(false)) },[])

  const fetchAI = async () => {
    setAL(true)
    try { const r = await axios.get('/api/ai/settlement/summary/pk_live_demo_raj_merchant_001'); setAI(r.data.summary) }
    catch { toast.error('AI summary unavailable') }
    finally { setAL(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">Settlements</h1><p className="text-slate-500 text-sm mt-1">Payout history and reconciliation</p></div>
        <button onClick={fetchAI} disabled={aiLoad} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60">
          {aiLoad?<Loader2 size={14} className="animate-spin"/>:<Sparkles size={14}/>}AI Summary
        </button>
      </div>
      {aiSummary && (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3"><Sparkles size={16} className="text-violet-600"/><span className="font-semibold text-violet-800 text-sm">AI Settlement Analysis</span></div>
          <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">{aiSummary}</p>
        </div>
      )}
      {loading?<div className="space-y-3 animate-pulse">{[1,2].map(i=><div key={i} className="h-24 bg-slate-100 rounded-2xl"/>)}</div>:
       settlements.length===0?(
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
          <div className="text-3xl mb-2">💳</div>
          <div>No settlements yet. Settlements are generated weekly.</div>
        </div>
      ):settlements.map((s:any)=>(
        <div key={s.id} className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold text-slate-800">{new Date(s.period_start).toLocaleDateString('en-IN',{month:'short',day:'numeric'})} — {new Date(s.period_end).toLocaleDateString('en-IN',{month:'short',day:'numeric',year:'numeric'})}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.tx_count} transactions</div>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${s.status==='settled'?'bg-green-100 text-green-700':s.status==='pending'?'bg-blue-100 text-blue-700':'bg-yellow-100 text-yellow-700'}`}>{s.status}</span>
          </div>
          <div className="grid grid-cols-4 gap-3 text-sm">
            {[{l:'Gross',v:`₹${parseFloat(s.gross_amount||0).toLocaleString()}`},{l:'Fees',v:`-₹${parseFloat(s.fees||0).toLocaleString()}`,r:true},{l:'Tax',v:`-₹${parseFloat(s.tax||0).toLocaleString()}`,r:true},{l:'Net Payout',v:`₹${parseFloat(s.net_amount||0).toLocaleString()}`,e:true}].map(x=>(
              <div key={x.l} className={`rounded-xl p-2.5 ${x.e?'bg-emerald-50 border border-emerald-100':'bg-slate-50'}`}>
                <div className={`text-xs ${x.e?'text-emerald-600':'text-slate-400'}`}>{x.l}</div>
                <div className={`font-bold ${x.r?'text-red-600':x.e?'text-emerald-700':'text-slate-800'}`}>{x.v}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
