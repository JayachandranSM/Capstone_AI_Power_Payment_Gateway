import { useEffect, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { FileText, ChevronDown, ChevronUp, Loader2, Sparkles } from 'lucide-react'

const SC: Record<string,string> = { open:'bg-red-100 text-red-700',under_review:'bg-yellow-100 text-yellow-700',resolved_customer:'bg-green-100 text-green-700',resolved_merchant:'bg-blue-100 text-blue-700',escalated:'bg-purple-100 text-purple-700',closed:'bg-slate-100 text-slate-600' }

export default function DisputeManager() {
  const [disputes, setD] = useState<any[]>([])
  const [loading, setL] = useState(true)
  const [expanded, setE] = useState<string|null>(null)
  const [agentLoad, setAL] = useState<string|null>(null)
  const [agentResults, setAR] = useState<Record<string,any>>({})

  useEffect(()=>{ axios.get('/api/v1/disputes').then(r=>setD(r.data||[])).finally(()=>setL(false)) },[])

  const runAgent = async (dispute:any) => {
    if (agentResults[dispute.id]) return
    setAL(dispute.id)
    try {
      const r = await axios.post('/api/ai/agents/resolve-dispute',{dispute_id:dispute.id})
      setAR(prev=>({...prev,[dispute.id]:r.data.dispute_analysis}))
      toast.success('AI analysis complete')
    } catch { toast.error('Agent unavailable') }
    finally { setAL(null) }
  }

  const resolve = async (id:string, status:string) => {
    try { await axios.patch(`/api/v1/disputes/${id}/resolve`,{status,resolution:'Resolved by admin after review'}); toast.success(`Dispute ${status}`); setD(d=>d.map(x=>x.id===id?{...x,status}:x)) }
    catch { toast.error('Failed to resolve') }
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">Dispute Manager</h1><p className="text-slate-500 text-sm mt-1">{disputes.length} total disputes</p></div>
      {loading?<div className="space-y-3">{[1,2,3].map(i=><div key={i} className="h-16 bg-slate-100 rounded-2xl animate-pulse"/>)}</div>:
       disputes.length===0?<div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center"><FileText size={40} className="text-slate-300 mx-auto mb-3"/><div className="text-slate-400">No disputes</div></div>:(
        <div className="space-y-3">
          {disputes.map(d=>(
            <div key={d.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              <div className="p-4 flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SC[d.status]||'bg-slate-100 text-slate-600'}`}>{d.status.replace('_',' ')}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${d.priority==='urgent'?'bg-red-100 text-red-700':d.priority==='high'?'bg-orange-100 text-orange-700':'bg-slate-100 text-slate-600'}`}>{d.priority}</span>
                    <span className="text-xs text-slate-400 font-mono">{d.transaction_id?.slice(0,8).toUpperCase()}</span>
                  </div>
                  <div className="text-sm text-slate-700">{d.reason?.slice(0,120)}{d.reason?.length>120?'…':''}</div>
                  <div className="text-xs text-slate-400 mt-1">{new Date(d.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
                </div>
                <div className="flex items-center gap-2">
                  {d.status==='open'&&<>
                    <button onClick={()=>resolve(d.id,'resolved_customer')} className="text-xs bg-green-50 border border-green-200 text-green-700 px-2 py-1 rounded-lg hover:bg-green-100">Resolve ✓</button>
                    <button onClick={()=>runAgent(d)} disabled={!!agentLoad} className="flex items-center gap-1 text-xs bg-violet-50 border border-violet-200 text-violet-700 px-2 py-1 rounded-lg hover:bg-violet-100">
                      {agentLoad===d.id?<Loader2 size={10} className="animate-spin"/>:<Sparkles size={10}/>}AI Agent
                    </button>
                  </>}
                  <button onClick={()=>setE(expanded===d.id?null:d.id)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500">{expanded===d.id?<ChevronUp size={14}/>:<ChevronDown size={14}/>}</button>
                </div>
              </div>
              {expanded===d.id&&(
                <div className="border-t border-slate-100 bg-slate-50 p-4 text-sm space-y-3">
                  <div><span className="text-slate-500">Full reason: </span><span className="text-slate-800">{d.reason}</span></div>
                  {agentResults[d.id]&&(
                    <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2"><Sparkles size={14} className="text-violet-600"/><span className="text-xs font-semibold text-violet-700">Dispute Agent Analysis</span></div>
                      <div className="text-sm text-slate-700 mb-2">{agentResults[d.id].llm_analysis}</div>
                      <div className="text-xs font-semibold text-slate-600 mb-1">Root cause ranking:</div>
                      {agentResults[d.id].root_cause_ranking?.map((rc:any,i:number)=>(
                        <div key={i} className="text-xs text-slate-600 flex items-center gap-2 mb-0.5">
                          <span className="font-semibold">{(rc.likelihood*100).toFixed(0)}%</span>
                          <span>{rc.hypothesis}</span>
                          <span className="text-slate-400">— {rc.evidence}</span>
                        </div>
                      ))}
                      <div className="mt-2 text-xs"><span className="font-semibold text-green-700">Recommended: </span>{agentResults[d.id].recommended_resolution?.replace('_',' ')}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
