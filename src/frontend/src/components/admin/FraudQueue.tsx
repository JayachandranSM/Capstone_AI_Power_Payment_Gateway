import { useEffect, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { ShieldAlert, ChevronDown, ChevronUp, Loader2, CheckCircle, XCircle, Sparkles } from 'lucide-react'

export default function FraudQueue() {
  const [alerts, setAlerts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string|null>(null)
  const [aiExpl, setAiExpl] = useState<Record<string,string>>({})
  const [aiLoad, setAiL] = useState<string|null>(null)
  const [filter, setFilter] = useState('open')

  const fetch = async (s=filter) => {
    setLoading(true)
    try { const r = await axios.get(`/api/v1/admin/fraud-alerts?status=${s}`); setAlerts(r.data||[]) }
    finally { setLoading(false) }
  }
  useEffect(()=>{fetch()},[filter])

  const explain = async (alert:any) => {
    if (aiExpl[alert.id]) return
    setAiL(alert.id)
    try {
      const rules = typeof alert.rules_triggered==='string'?JSON.parse(alert.rules_triggered||'[]'):alert.rules_triggered||[]
      const r = await axios.post('/api/ai/fraud/explain',{transaction_id:alert.transaction_id,fraud_score:alert.fraud_score,rules_triggered:rules})
      setAiExpl(prev=>({...prev,[alert.id]:r.data.explanation}))
    } catch { toast.error('AI explanation unavailable') }
    finally { setAiL(null) }
  }

  const resolve = async (id:string, status:string) => {
    try { await axios.patch(`/api/v1/admin/fraud-alerts/${id}/resolve`,{status,feedback:status}); toast.success(`Alert ${status}`); setAlerts(a=>a.filter(x=>x.id!==id)) }
    catch { toast.error('Failed to resolve') }
  }

  const SEV: Record<string,string> = { critical:'bg-red-100 text-red-700 border-red-200',high:'bg-orange-100 text-orange-700 border-orange-200',medium:'bg-yellow-100 text-yellow-700 border-yellow-200',low:'bg-blue-100 text-blue-700 border-blue-200' }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">Fraud Queue</h1><p className="text-slate-500 text-sm mt-1">{alerts.length} alerts · AI-assisted review</p></div>
        <div className="flex gap-2">
          {['open','investigating','resolved','false_positive'].map(s=>(
            <button key={s} onClick={()=>setFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${filter===s?'bg-slate-800 text-white border-slate-800':'bg-white text-slate-600 border-slate-200'}`}>
              {s.replace('_',' ')}
            </button>
          ))}
        </div>
      </div>
      {loading?<div className="space-y-3">{[1,2,3].map(i=><div key={i} className="h-20 bg-slate-100 rounded-2xl animate-pulse"/>)}</div>:
       alerts.length===0?<div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center"><ShieldAlert size={40} className="text-slate-300 mx-auto mb-3"/><div className="text-slate-400">No {filter} fraud alerts</div></div>:(
        <div className="space-y-3">
          {alerts.map(alert=>{
            const isOpen = expanded===alert.id
            const rules = typeof alert.rules_triggered==='string'?JSON.parse(alert.rules_triggered||'[]'):alert.rules_triggered||[]
            return (
              <div key={alert.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                <div className="p-4 flex items-center gap-3">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${SEV[alert.severity]||'bg-slate-100 text-slate-600 border-slate-200'}`}>{alert.severity?.toUpperCase()}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><span className="font-semibold text-slate-800">{alert.sender_name||'Unknown'}</span><span className="text-xs text-slate-400">· {alert.sender_email}</span></div>
                    <div className="text-xs text-slate-500 mt-0.5">₹{parseFloat(alert.amount||0).toLocaleString()} · {alert.payment_method?.toUpperCase()} · Score: <span className="font-bold text-red-600">{(alert.fraud_score*100).toFixed(0)}%</span></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={()=>explain(alert)} className="flex items-center gap-1 text-xs bg-violet-50 border border-violet-200 text-violet-700 px-2.5 py-1.5 rounded-lg hover:bg-violet-100">
                      {aiLoad===alert.id?<Loader2 size={11} className="animate-spin"/>:<Sparkles size={11}/>}AI
                    </button>
                    <button onClick={()=>resolve(alert.id,'false_positive')} className="flex items-center gap-1 text-xs bg-green-50 border border-green-200 text-green-700 px-2.5 py-1.5 rounded-lg hover:bg-green-100"><CheckCircle size={11}/>Clear</button>
                    <button onClick={()=>resolve(alert.id,'resolved')} className="flex items-center gap-1 text-xs bg-red-50 border border-red-200 text-red-700 px-2.5 py-1.5 rounded-lg hover:bg-red-100"><XCircle size={11}/>Block</button>
                    <button onClick={()=>setExpanded(isOpen?null:alert.id)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">{isOpen?<ChevronUp size={14}/>:<ChevronDown size={14}/>}</button>
                  </div>
                </div>
                {isOpen&&(
                  <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-4">
                    {rules.length>0&&(
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Rules Triggered</div>
                        <div className="flex flex-wrap gap-2">
                          {rules.map((r:any,i:number)=>(
                            <div key={i} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs">
                              <span className="font-semibold text-red-600">{r.rule}</span>
                              <span className="text-slate-500 ml-1.5">w={r.weight}</span>
                              {r.detail&&<div className="text-slate-400 mt-0.5">{r.detail}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {aiExpl[alert.id]&&(
                      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2"><Sparkles size={14} className="text-violet-600"/><span className="text-xs font-semibold text-violet-700">AI Analysis</span></div>
                        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{aiExpl[alert.id]}</p>
                      </div>
                    )}
                    <div className="text-xs text-slate-400 font-mono">TX: {alert.transaction_id} · Alert: {alert.id?.slice(0,8).toUpperCase()}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
