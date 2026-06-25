import { useState } from 'react'
import axios from 'axios'
import { Search, Loader2, Sparkles, Zap } from 'lucide-react'

const EXAMPLES = ['Why are card payments failing?','Show failed UPI transactions','Which transactions were flagged?','Find high-value declined payments','Card testing pattern transactions']

export default function NLPLookup() {
  const [query, setQuery]   = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoad]  = useState(false)
  const [toolResult, setTool] = useState<any>(null)
  const [toolLoad, setTL]   = useState(false)

  const search = async (q: string) => {
    if (!q.trim()) return
    setLoad(true); setResult(null)
    try { const r = await axios.post('/api/ai/nlp/failure-reason',{query:q,top_k:10}); setResult(r.data) }
    catch { setResult({answer:'AI service unavailable.',transactions:[],structured_reasons:[]}) }
    finally { setLoad(false) }
  }

  const toolCall = async (q: string) => {
    setTL(true); setTool(null)
    try { const r = await axios.post('/api/ai/tools/call',{query:q}); setTool(r.data) }
    catch { setTool({answer:'Tool calling failed.',tool_used:null}) }
    finally { setTL(false) }
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">NLP Transaction Lookup</h1><p className="text-slate-500 text-sm mt-1">Query failed transactions in plain English · Tool calling enabled</p></div>
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-3.5 text-slate-400"/>
            <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search(query)}
              placeholder="Describe the failure pattern you're investigating…"
              className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
          <button onClick={()=>search(query)} disabled={!query.trim()||loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl px-5 py-3 text-sm font-medium flex items-center gap-2">
            {loading?<Loader2 size={14} className="animate-spin"/>:<Search size={14}/>}NLP Search
          </button>
          <button onClick={()=>toolCall(query)} disabled={!query.trim()||toolLoad}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl px-5 py-3 text-sm font-medium flex items-center gap-2">
            {toolLoad?<Loader2 size={14} className="animate-spin"/>:<Zap size={14}/>}Tool Call
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map(q=><button key={q} onClick={()=>{setQuery(q);search(q)}} className="text-xs border border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-full">{q}</button>)}
        </div>
      </div>

      {toolResult&&!toolLoad&&(
        <div className="bg-white rounded-2xl border border-violet-200 p-5">
          <div className="flex items-center gap-2 mb-3"><Zap size={16} className="text-violet-600"/><span className="font-semibold text-slate-800">Tool Call Result</span>{toolResult.tool_used&&<span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">{toolResult.tool_used}</span>}</div>
          <p className="text-sm text-slate-700 mb-3 leading-relaxed">{toolResult.answer}</p>
          {toolResult.tool_result&&<pre className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 overflow-auto">{JSON.stringify(toolResult.tool_result,null,2)}</pre>}
        </div>
      )}

      {loading&&<div className="bg-white rounded-2xl border border-slate-100 p-8 text-center"><Loader2 size={32} className="animate-spin text-blue-600 mx-auto mb-3"/><div className="text-slate-500 text-sm">Analysing transactions…</div></div>}

      {result&&!loading&&(
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center gap-2 mb-3"><Sparkles size={16} className="text-violet-600"/><span className="font-semibold text-slate-800">AI Analysis</span><span className="text-xs text-slate-400">Confidence: {(result.confidence*100).toFixed(0)}%</span></div>
            <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">{result.answer}</p>
            {result.escalation_needed&&<div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">⚠️ Escalation recommended: {result.escalation_reason}</div>}
          </div>
          {result.fix_suggestions?.length>0&&(
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <h3 className="font-semibold text-slate-800 mb-3">Fix Suggestions</h3>
              <div className="space-y-3">
                {result.fix_suggestions.map((s:any,i:number)=>(
                  <div key={i} className="bg-slate-50 rounded-xl p-3">
                    <div className="text-sm font-medium text-slate-800 mb-1">{s.pattern}</div>
                    <ul className="space-y-0.5">{s.fixes.map((f:string,j:number)=><li key={j} className="text-xs text-slate-600 flex items-start gap-1.5"><span className="text-green-500 mt-0.5">✓</span>{f}</li>)}</ul>
                    {s.escalate&&<div className="text-xs text-red-600 mt-1">⚠️ Requires escalation</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {result.transactions?.length>0&&(
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              <div className="p-4 border-b border-slate-100"><h3 className="font-semibold text-slate-800">{result.transactions.length} matching transactions</h3></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b"><tr>{['ID','Failure Reason','Amount','Method','Status'].map(h=><th key={h} className="text-left px-4 py-2.5 text-xs text-slate-500 font-semibold uppercase">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {result.transactions.map((tx:any)=>(
                      <tr key={tx.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{tx.id?.slice(0,8).toUpperCase()}</td>
                        <td className="px-4 py-3 text-xs text-slate-700 max-w-[200px] truncate">{tx.failure_reason||'—'}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{parseFloat(tx.amount||0).toLocaleString()} {tx.currency}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 uppercase">{tx.payment_method}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tx.status==='failed'?'bg-red-100 text-red-700':'bg-yellow-100 text-yellow-700'}`}>{tx.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
